# HTML Carousel Reel

Open-source local tool to convert HTML carousel slides into motion-designed vertical reel videos (`.mp4`) using [HyperFrames](https://github.com/heygen-com/hyperframes).

No paid API required. Runs on your machine.

## Features

- HTML carousel -> reel video (`mp4`)
- Automatic motion design per slide:
  - line/word reveals
  - staggered card/block entries
  - number counter animation
  - accent/progress bar growth
  - glow/light sweeps
- Prompt-based style tuning (`--prompt`)
- Batch render all HTML files in a folder

## Requirements

- Node.js `22+`
- FFmpeg installed on `PATH`
- macOS/Linux/Windows (with Node + FFmpeg)

## Quick Start

```bash
# 1) Clone
git clone <your-github-repo-url>
cd html-carousel-reel

# 2) Install
npm install

# 3) Render one file
./render-reel ./html-carousel/ai_coding_agents_signal_carousel.html
```

Output is saved next to the source file:

```text
html-carousel/ai_coding_agents_signal_carousel_reel.mp4
```

## Prompt-driven style

You can tune animation style with natural language:

```bash
./render-reel ./html-carousel/github_repos_for_claude_code_carousel.html \
  --prompt "cinematic neon, bold, fast" \
  --seconds-per-slide 3.4
```

Supported style intents include keywords like:
- `cinematic`, `epic`, `movie`
- `fast`, `energetic`, `punchy`, `viral`
- `minimal`, `clean`, `subtle`
- `soft`, `smooth`, `elegant`
- `dramatic`, `bold`
- `glow`, `neon`, `shiny`

## Common commands

```bash
# Single render (via npm)
npm run render:reel -- ./html-carousel/coding_mistakes_beginners_carousel.html

# Single render with custom output
npm run render:reel -- ./html-carousel/career_ops_hindi_carousel.html \
  --output ./html-carousel/career_ops_hindi_custom.mp4

# Batch render all HTML files in html-carousel/
npm run render:all

# Batch render with shared style prompt
npm run render:all -- --prompt "cinematic, glow, bold" --seconds-per-slide 3.2
```

## How it works

1. Detects `.slide` blocks from the source HTML.
2. Converts slides into a HyperFrames composition in `.hyperframes-reel/`.
3. Applies timeline animations and prompt-based style profile.
4. Runs `npx hyperframes render` locally.
5. Writes final `.mp4` next to the input HTML.

## Project structure

```text
scripts/
  render-carousel-reel.mjs   # main converter + animation compiler
  render-all.mjs             # batch rendering helper
render-reel                  # shortcut wrapper
html-carousel/               # sample/input carousel files
```

## Open source publishing

### 1) Initialize git (if needed)

```bash
git init
git add .
git commit -m "feat: open-source local html carousel reel generator"
```

### 2) Create GitHub repo and push

```bash
git branch -M main
git remote add origin https://github.com/<your-username>/<repo-name>.git
git push -u origin main
```

## License

MIT. See [LICENSE](./LICENSE).
