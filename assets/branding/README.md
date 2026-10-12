# Brand assets

This directory contains the shared assets and editable scene schema for **Sinh ra để nói tiếng Anh**. Generated PNG art is reused by the renderer and never regenerated for each video.

- `background-main.png`, `background-warm.png`, `background-cool.png`: reusable 1080×1920 paper textures generated with OpenAI image generation from original prompts; no text, logo, character, or third-party reference artwork.
- `teacher-female.png`: original transparent 2D illustration generated with OpenAI image generation from the written character brief.
- `brand-logo.svg`: original vector mark combining a speech bubble and an open book, with page name and tagline.
- `visual-template.json`: shared 1080×1920 scene layout consumed by the FFmpeg renderer, preview endpoint, and Visual Editor.
- `fonts/`: Be Vietnam Pro Regular, SemiBold and Bold from the official Google Fonts repository. The font family is distributed under the SIL Open Font License 1.1; see `fonts/OFL.txt`.

For design prompts and asset provenance, see `prompts/branding-assets.md`.
