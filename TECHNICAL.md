# Technical Reference — pointer

The developer-facing reference lives at [`docs/technical.md`](docs/technical.md).

It covers the tech stack, pipeline (detect → gate + OCR → translate → inpaint → paint),
detection models and settings, OCR engines (in-tree JS CTC, zero `eval`), the Fast/Quality
inpaint ladder, the script gate, security hardening (SSRF allowlist, schema validation,
SHA-256 verification), auto-translate engine and site adapters, model storage and GPU
controls, environment overrides, project structure (background / content / offscreen /
popup / setup + `lib/` modules + `scripts/` checks), debug logging, and model/runtime
licenses (AGPL-3.0-or-later program; on-demand weights per upstream license). The user-facing
overview stays in [`README.md`](README.md).
