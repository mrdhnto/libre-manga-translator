/**
 * Detection region build: the deterministic ordering, the two merge tiers,
 * and the size rules.
 *
 * Everything here is sorted before it merges - the merges are single-pass and
 * non-transitive, so an unsorted input would make the answer depend on
 * iteration order, and it must not.
 */

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Two extended boxes become one above this share of the smaller's area. */
export const MERGE_OVERLAP_SHARE = 0.2;
/** A box the detector is at least this sure of is never dropped for size.
 * The small-box rule is for speckle; measured dialogue columns at 0.84-0.94
 * were vanishing under it while the actual speckle scored 0.41. */
export const SIZE_DROP_MAX_CONFIDENCE = 0.7;

const rectOf = (b: Bbox): Rect => ({
  x: Math.min(b.x1, b.x2),
  y: Math.min(b.y1, b.y2),
  w: Math.abs(b.x2 - b.x1),
  h: Math.abs(b.y2 - b.y1),
});

const bboxOf = (r: Rect, confidence: number): Bbox => ({
  x1: r.x,
  y1: r.y,
  x2: r.x + r.w,
  y2: r.y + r.h,
  confidence,
});

const area = (r: Rect) => r.w * r.h;
const centre = (r: Rect): [number, number] => [r.x + r.w / 2, r.y + r.h / 2];
const contains = (r: Rect, x: number, y: number) =>
  x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
const hull = (a: Rect, b: Rect): Rect => {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const right = Math.max(a.x + a.w, b.x + b.w);
  const bottom = Math.max(a.y + a.h, b.y + b.h);
  return { x, y, w: right - x, h: bottom - y };
};
const intersectionArea = (a: Rect, b: Rect) => {
  const w = Math.max(
    0,
    Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x),
  );
  const h = Math.max(
    0,
    Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y),
  );
  return w * h;
};

/** `(y, x, h, w)` reading order - the reproducibility fact. */
function inReadingOrder(boxes: Bbox[]): Bbox[] {
  return [...boxes].sort((a, b) => {
    const ra = rectOf(a);
    const rb = rectOf(b);
    return (
      ra.y - rb.y ||
      ra.x - rb.x ||
      ra.h - rb.h ||
      ra.w - rb.w
    );
  });
}

/** Merge boxes whose centre falls inside another box; single-pass,
 * non-transitive, confidence = max of the group. */
export function mergeCentreInBox(boxes: Bbox[]): Bbox[] {
  const sorted = inReadingOrder(boxes);
  const rects = sorted.map(rectOf);
  const absorbed = new Array(sorted.length).fill(false);
  const out: Bbox[] = [];
  for (let i = 0; i < sorted.length; i++) {
    if (absorbed[i]) continue;
    let current = rects[i];
    let conf = sorted[i].confidence;
    for (let j = i + 1; j < sorted.length; j++) {
      if (absorbed[j]) continue;
      const [cx, cy] = centre(rects[j]);
      const [ox, oy] = centre(current);
      if (!contains(current, cx, cy) && !contains(rects[j], ox, oy))
        continue;
      current = hull(current, rects[j]);
      conf = Math.max(conf, sorted[j].confidence);
      absorbed[j] = true;
    }
    out.push(bboxOf(current, conf));
  }
  return out;
}

/** Overlap by more than MERGE_OVERLAP_SHARE of the smaller area
 * (multiplication, not division - a box sitting exactly on the threshold
 * falls on the same side every time). */
export function overlapsEnough(a: Bbox, b: Bbox): boolean {
  const ra = rectOf(a);
  const rb = rectOf(b);
  const smaller = Math.min(area(ra), area(rb));
  return smaller > 0 && intersectionArea(ra, rb) > MERGE_OVERLAP_SHARE * smaller;
}

/** Median box area computed BEFORE filtering, so the statistic is not skewed
 * by the filter it feeds. */
export function medianBoxArea(boxes: Bbox[]): number {
  if (boxes.length === 0) return 0;
  const areas = boxes.map((b) => area(rectOf(b))).sort((a, b) => a - b);
  return areas[Math.floor(areas.length / 2)];
}

export type SizeVerdict = "keep" | "drop" | "flag-large";

export function sizeVerdict(
  boxArea: number,
  medianArea: number,
  boxHeight: number,
  pageHeight: number,
  confidence: number,
): SizeVerdict {
  if (
    medianArea > 0 &&
    boxArea < 0.15 * medianArea &&
    confidence < SIZE_DROP_MAX_CONFIDENCE
  )
    return "drop";
  if (medianArea > 0 && boxArea > 40.0 * medianArea) return "flag-large";
  if (boxHeight > 0.25 * pageHeight) return "flag-large";
  return "keep";
}

/** Grow every side, and a little more on the right: vertical Japanese runs
 * right-to-left, so the right edge is where the next column and the AA spill
 * are. */
function grown(b: Bbox, all: number, extraRight: number, pageW: number, pageH: number): Bbox {
  const r = rectOf(b);
  const x = Math.max(0, r.x - all);
  const y = Math.max(0, r.y - all);
  const right = Math.min(pageW, r.x + r.w + all + extraRight);
  const bottom = Math.min(pageH, r.y + r.h + all);
  return bboxOf({ x, y, w: Math.max(0, right - x), h: Math.max(0, bottom - y) }, b.confidence);
}

export interface RefinedResult {
  boxes: Bbox[];
  merged: number;
  dropped: number;
  flagged: number;
}

/**
 * Post-NMS region build, in order:
 * centre-merge (RAW boxes) → size rules ASKED OF THE RAW MERGED BOX
 * (drop speckle; an oversized box is only flagged) → growth tiers
 * (+2 all, +3 right; +5 → extended) → overlap-merge of the extended tier.
 * The output box is the MASKING tier (what gets cropped/inpainted).
 */
export function refineDetections(
  detections: Bbox[],
  pageW: number,
  pageH: number,
): RefinedResult {
  const median = medianBoxArea(detections);
  const beforeMerge = detections.length;

  const stage1 = mergeCentreInBox(detections);
  let dropped = 0;
  let flagged = 0;
  const kept = stage1.filter((b) => {
    const r = rectOf(b);
    const verdict = sizeVerdict(area(r), median, r.h, pageH, b.confidence);
    if (verdict === "drop") {
      dropped++;
      return false;
    }
    if (verdict === "flag-large") flagged++;
    return true;
  });

  const extended = kept.map((b) =>
    grown(grown(b, 2, 1, pageW, pageH), 5, 0, pageW, pageH),
  );

  // extended-tier merge: transitively group boxes that overlap by >20% of
  // the smaller. Iteration is over the reading-ordered list, so grouping is
  // deterministic.
  const parent = extended.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < extended.length; i++) {
    for (let j = i + 1; j < extended.length; j++) {
      if (overlapsEnough(extended[i], extended[j])) parent[find(j)] = find(i);
    }
  }
  const groups = new Map<number, Bbox[]>();
  extended.forEach((box, i) => {
    const root = find(i);
    const g = groups.get(root) ?? [];
    g.push(box);
    groups.set(root, g);
  });

  const boxes: Bbox[] = [];
  for (const group of groups.values()) {
    let box = group[0];
    for (const b of group.slice(1))
      box = bboxOf(hull(rectOf(box), rectOf(b)), Math.max(box.confidence, b.confidence));
    boxes.push(box);
  }

  return {
    boxes: inReadingOrder(boxes),
    merged: beforeMerge - stage1.length,
    dropped,
    flagged,
  };
}
