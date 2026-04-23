# Contributing

## Setup

```bash
npm install
```

Requirements:
- Node.js 22+
- FFmpeg installed and available on `PATH`

## Local checks

```bash
npm run check
```

## Development flow

1. Create a feature branch.
2. Make focused changes.
3. Test with at least one real HTML carousel file.
4. Open a PR with:
   - what changed
   - before/after behavior
   - sample command used

## Style notes

- Keep dependencies minimal.
- Keep generated files out of git (`.hyperframes-reel`, `*_reel.mp4`).
- Prefer deterministic behavior over random effects.
