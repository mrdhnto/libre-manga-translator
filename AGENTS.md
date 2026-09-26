# AGENTS.md — Project Context Protocol

This file teaches the LLM how to learn this project. Follow exactly.

## 0. Session Resume (Read First)

- **`CLAUDE.md`** (root) = session-state + vibe-code onboarding. Read FIRST.
  It records what phase is shipped, what changed, and what to build next, so a
  new session resumes fast.
- Workspace = single consolidated project at repo root (Libre Manga Translator v1).

## 1. Entry Protocol

Before any task:
1. Read `CLAUDE.md` (session resume)
2. Read `.project-map/` files in alphanumeric order (`000-*` → `001-*` → ...)
3. For model/pipeline detail (detectors, OCR engines, inpaint ladder, licenses),
   read `docs/technical.md` (user-facing overview stays in `README.md`)
4. If `.project-map/` is empty or absent, infer context from `package.json`,
   entry points, folder structure, and write findings back to `.project-map/`
4. After reading, verify you can answer: "What does this project do? What is
   the tech stack? What is the request flow? What phase is current?"

## 2. Context Freshness

- Re-read `CLAUDE.md` + `.project-map/` at the start of each session
- If code contradicts the docs, flag the inconsistency — do not silently rely
  on stale context
- After shipping a phase, update `CLAUDE.md` + `.project-map/007-roadmap.md`

## 3. Coding Rules

- **Pattern-first:** Before adding new code, find 3 similar existing files to match conventions
- **No assumptions:** Do not introduce libraries absent from package manager or `.project-map/`
- **No bundled GPL weights:** GPL-3.0 models (e.g. ComicTextDetector) are optional
  on-demand user downloads only — never commit weights or hard-bundle them
- **Minimalism:** Answer in 1-3 lines unless asked for depth. No preamble/postamble
- **References:** When citing code, use `file:line` format
- **Checks before commit:** `bun run check` (0 errors) + `check:inpaint` + `check:gate`
  (`scripts/ocr-selfcheck.ts` has no `check:ocr` script — run via `bun scripts/ocr-selfcheck.ts`)

## 4. When Context Fails

If `CLAUDE.md` or `.project-map/` is incomplete or missing:
- Flag it: "`.project-map/` missing or incomplete — inferring from codebase"
- After inferring, offer to write the findings into `.project-map/` and `CLAUDE.md`

---

**Version:** 1.3
**Scope:** Project-introspective agent instructions
**Designed for:** Any project — swap `.project-map/` content per project
