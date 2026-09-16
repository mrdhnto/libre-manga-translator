/**
 * Inpaint engine-ladder constants in one place, stated in 8-bit luma levels.
 * The values come from fixture sweeps (flat paper, JPEG q75 grain, halftone);
 * several are *related* - EDIT_MARGIN is derived from the others, and a
 * hardcoded margin once left every rung-1 region a pixel outside the
 * fidelity contract. A derived constant should be derived where its inputs
 * are visible.
 */

/** First growth step of the mask candidate series, px. */
export const MIN_MASK_THICKNESS = 4;

/** Each subsequent step; growth is cumulative (dilate previous, not fresh). */
export const MASK_GROWTH_STEP = 2;

/** How many growth steps follow the first. */
export const MASK_GROWTH_STEPS = 11;

/** Ring = annulus between dilate(k) and dilate(k + ANNULUS_WIDTH), px. */
export const ANNULUS_WIDTH = 4;

/** Below this deviation the largest under-floor candidate wins (swallows the
 * AA fringe). Takes precedence over the monotone gate. */
export const FLAT_FLOOR = 0.5;

/** Deviation above which a fitted-but-poor box still goes to the inpainter. */
export const INPAINT_MIN_STD = 15;

/** Chosen-thickness ceiling for that second inpaint population. */
export const MIN_INPAINTING_RADIUS = 5;

/** Post-engine trim: output is cut back to mask ⊕ ISOLATION_RADIUS. */
export const ISOLATION_RADIUS = 5;

/** Rung 1 dilates the mask by this before compositing the denoised crop. */
export const DENOISE_DILATION = 5;

/** Hard radius-truncated feather, never a Gaussian (σ=1 spreads 2-3 px and
 * would put rung 1 outside EDIT_MARGIN). */
export const DENOISE_FEATHER = 1;

/** Fidelity margin - derived, do not hardcode. */
export const EDIT_MARGIN = Math.max(
  ISOLATION_RADIUS,
  DENOISE_DILATION + DENOISE_FEATHER,
);

/** Decline metric surround width. A 4 px ring was measured to fail. */
export const QUALITY_SURROUND_WIDTH = 32;

/** Interior/surround edge-energy ratio above which a region is declined. */
export const QUALITY_EDGE_RATIO = 2.0;

/** Fit-fail threshold = max(8, 2.5 * noiseSigma), 8-bit levels. */
export const FIT_DEV_MIN = 8;
export const FIT_DEV_NOISE_FACTOR = 2.5;

/** Noise σ at/above which an accepted fill starts on rung 1 (JPEG grain). */
export const DENOISE_NOISE_FLOOR = 4;

/** Ink-seed threshold factor between ink and paper (ocr/utils.ts math). */
export const INK_PAPER_FACTOR = 0.4;

/** Component filters for the ink seed. */
export const MIN_COMPONENT_PX = 4;
export const MAX_COMPONENT_FRACTION = 0.6;

/** Crop padding around a bbox: worst-case growth + annulus + isolation + feather. */
export const CROP_MARGIN =
  MIN_MASK_THICKNESS +
  MASK_GROWTH_STEP * MASK_GROWTH_STEPS +
  ANNULUS_WIDTH +
  ISOLATION_RADIUS +
  EDIT_MARGIN +
  1;

/** Degenerate guard reused from telea: skip a crop whose mask covers >80%. */
export const MAX_MASKED_FRACTION = 0.8;
