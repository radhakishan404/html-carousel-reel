#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import * as cheerio from "cheerio";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const workDir = path.join(rootDir, ".hyperframes-reel");
const compositionsDir = path.join(workDir, "compositions");

function printUsage() {
  console.log(`Usage:
  node scripts/render-carousel-reel.mjs <input.html> [--output out.mp4] [--seconds-per-slide 3.6] [--fps 30] [--quality standard] [--prompt "cinematic neon, punchy"] [--width 1080 --height 1350] [--no-render]

Examples:
  npm run render:reel -- ./html-carousel/ai_coding_agents_signal_carousel.html
  npm run render:reel -- ./html-carousel/coding_mistakes_beginners_carousel.html --seconds-per-slide 3.2 --output ./html-carousel/coding_mistakes_beginners_carousel_reel.mp4
  npm run render:reel -- ./html-carousel/github_repos_for_claude_code_carousel.html --prompt "cinematic, bold, glow, fast"
`);
}

function parseArgs(argv) {
  if (argv.length === 0 || argv.includes("-h") || argv.includes("--help")) {
    printUsage();
    process.exit(argv.length === 0 ? 1 : 0);
  }

  const positional = [];
  const opts = {
    secondsPerSlide: 3.6,
    fps: 30,
    quality: "standard",
    output: "",
    prompt: "",
    promptFile: "",
    width: null,
    height: null,
    noRender: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }

    if (arg === "--no-render") {
      opts.noRender = true;
      continue;
    }

    const next = argv[i + 1];
    if (next == null) {
      throw new Error(`Missing value for ${arg}`);
    }

    switch (arg) {
      case "--output":
      case "-o":
        opts.output = next;
        i += 1;
        break;
      case "--seconds-per-slide":
        opts.secondsPerSlide = Number(next);
        i += 1;
        break;
      case "--fps":
        opts.fps = Number(next);
        i += 1;
        break;
      case "--quality":
        opts.quality = next;
        i += 1;
        break;
      case "--prompt":
        opts.prompt = next;
        i += 1;
        break;
      case "--prompt-file":
        opts.promptFile = next;
        i += 1;
        break;
      case "--width":
        opts.width = Number(next);
        i += 1;
        break;
      case "--height":
        opts.height = Number(next);
        i += 1;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (positional.length === 0) {
    throw new Error("Missing input HTML path");
  }

  if (!Number.isFinite(opts.secondsPerSlide) || opts.secondsPerSlide <= 0.5) {
    throw new Error("--seconds-per-slide must be a number > 0.5");
  }

  if (!Number.isFinite(opts.fps) || opts.fps <= 0) {
    throw new Error("--fps must be a positive number");
  }

  if (opts.width != null && (!Number.isFinite(opts.width) || opts.width <= 0)) {
    throw new Error("--width must be a positive number");
  }

  if (opts.height != null && (!Number.isFinite(opts.height) || opts.height <= 0)) {
    throw new Error("--height must be a positive number");
  }

  return { input: positional[0], opts };
}

function even(value) {
  const rounded = Math.round(value);
  return rounded % 2 === 0 ? rounded : rounded + 1;
}

function findCssPx(styleText, variableName) {
  const escaped = variableName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`--${escaped}\\s*:\\s*([0-9]+(?:\\.[0-9]+)?)px`, "i");
  const match = styleText.match(regex);
  return match ? Number(match[1]) : null;
}

function findAspectRatio(styleText) {
  const match = styleText.match(/aspect-ratio\s*:\s*([0-9]+(?:\.[0-9]+)?)\s*\/\s*([0-9]+(?:\.[0-9]+)?)/i);
  if (!match) return null;
  const num = Number(match[1]);
  const den = Number(match[2]);
  if (!Number.isFinite(num) || !Number.isFinite(den) || num <= 0 || den <= 0) return null;
  return { num, den };
}

function detectDimensions(styleText) {
  const igWidth = findCssPx(styleText, "ig-width");
  const igHeight = findCssPx(styleText, "ig-height");
  const igExportScaleRaw = styleText.match(/--ig-export-scale\s*:\s*([0-9]+(?:\.[0-9]+)?)/i);
  const igExportScale = igExportScaleRaw ? Number(igExportScaleRaw[1]) : 2;
  if (igWidth && igHeight) {
    return {
      width: even(igWidth * igExportScale),
      height: even(igHeight * igExportScale),
      reason: "CSS vars --ig-width/--ig-height",
    };
  }

  const slideWidth = findCssPx(styleText, "slide-w");
  const slideHeight = findCssPx(styleText, "slide-h");
  if (slideWidth && slideHeight) {
    return {
      width: even(slideWidth * 2),
      height: even(slideHeight * 2),
      reason: "CSS vars --slide-w/--slide-h",
    };
  }

  const ratio = findAspectRatio(styleText);
  if (ratio) {
    const width = 1080;
    const height = even((width * ratio.den) / ratio.num);
    return {
      width,
      height,
      reason: `first aspect-ratio ${ratio.num}/${ratio.den}`,
    };
  }

  return {
    width: 1080,
    height: 1350,
    reason: "default 4:5",
  };
}

function stripSlideStateClasses(classAttr = "") {
  const classes = classAttr
    .split(/\s+/)
    .filter(Boolean)
    .filter((name) => name !== "active" && name !== "exit" && name !== "out");
  return classes.join(" ");
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function deriveStyleSpec(prompt) {
  const raw = String(prompt || "").trim().toLowerCase();
  const spec = {
    profile: "balanced",
    motion: 1,
    lights: 0.85,
    wordStagger: 0.012,
    blockStagger: 0.03,
    enterBlur: 8,
    exitBlur: 5,
    enterYOffset: 26,
    exitYOffset: 16,
    zoom: 1.012,
  };

  if (!raw) return spec;
  const has = (keywords) => keywords.some((word) => raw.includes(word));

  if (has(["fast", "energetic", "punchy", "viral", "snappy"])) {
    spec.profile = "energetic";
    spec.motion += 0.28;
    spec.wordStagger *= 0.72;
    spec.blockStagger *= 0.78;
    spec.enterYOffset += 8;
  }

  if (has(["cinematic", "film", "epic", "movie"])) {
    spec.profile = spec.profile === "balanced" ? "cinematic" : spec.profile;
    spec.lights += 0.2;
    spec.zoom += 0.006;
    spec.enterBlur += 2;
    spec.exitBlur += 1;
  }

  if (has(["neon", "glow", "shiny", "shine", "light"])) {
    spec.lights += 0.35;
  }

  if (has(["minimal", "clean", "subtle", "simple"])) {
    spec.profile = "minimal";
    spec.motion -= 0.2;
    spec.lights -= 0.4;
    spec.enterBlur -= 3;
    spec.exitBlur -= 2;
    spec.wordStagger *= 1.12;
    spec.blockStagger *= 1.08;
  }

  if (has(["soft", "smooth", "elegant"])) {
    spec.motion -= 0.14;
    spec.enterBlur -= 2;
    spec.exitBlur -= 1;
    spec.wordStagger *= 1.16;
  }

  if (has(["dramatic", "bold", "aggressive", "hard"])) {
    spec.motion += 0.24;
    spec.enterYOffset += 6;
    spec.exitYOffset += 4;
    spec.zoom += 0.004;
  }

  spec.motion = clamp(spec.motion, 0.7, 1.8);
  spec.lights = clamp(spec.lights, 0, 1.6);
  spec.wordStagger = clamp(spec.wordStagger, 0.006, 0.03);
  spec.blockStagger = clamp(spec.blockStagger, 0.014, 0.06);
  spec.enterBlur = clamp(spec.enterBlur, 2, 16);
  spec.exitBlur = clamp(spec.exitBlur, 0, 10);
  spec.enterYOffset = clamp(spec.enterYOffset, 10, 44);
  spec.exitYOffset = clamp(spec.exitYOffset, 6, 30);
  spec.zoom = clamp(spec.zoom, 1, 1.03);

  return spec;
}

function buildSlideAnimationScript(frameId, slideCompId, secondsPerSlide, styleSpec) {
  const styleJson = JSON.stringify(styleSpec);
  return `
      const frame = document.getElementById("${frameId}");
      const duration = ${secondsPerSlide};
      const style = ${styleJson};
      const exitStart = Math.max(0.35, duration - 0.38);

      function splitWords(el) {
        if (!el || el.hasAttribute("data-hf-split")) return [];
        if (el.children.length > 0) return [];
        const text = (el.textContent || "").trim();
        if (!text || text.length > 180) return [];
        const pieces = text.split(/(\\s+)/).filter((chunk) => chunk.length > 0);
        if (pieces.length < 3) return [];
        const frag = document.createDocumentFragment();
        const words = [];
        for (const piece of pieces) {
          if (/^\\s+$/.test(piece)) {
            frag.appendChild(document.createTextNode(piece));
            continue;
          }
          const span = document.createElement("span");
          span.className = "hf-word";
          span.textContent = piece;
          frag.appendChild(span);
          words.push(span);
        }
        el.textContent = "";
        el.appendChild(frag);
        el.setAttribute("data-hf-split", "1");
        return words;
      }

      function collectWordTargets() {
        const textLike = frame.querySelectorAll(
          "h1,h2,h3,h4,.sl-hero,.cta-title,.s1-headline,.s-val-title,.map-title,.hn-title,.persona-title,.metric-name,.metric-stars,.check-title,.sl-copy,.cta-text,.watch-chip"
        );
        const words = [];
        textLike.forEach((el) => {
          if (el.closest("svg,pre,code")) return;
          words.push(...splitWords(el));
        });
        return words.slice(0, 180);
      }

      function parseCounterText(text) {
        const trimmed = (text || "").trim();
        const m = trimmed.match(/^([^\\d-]*)(-?\\d[\\d,]*\\.?\\d*)([^\\d]*)$/);
        if (!m) return null;
        const value = Number(m[2].replace(/,/g, ""));
        if (!Number.isFinite(value)) return null;
        return { prefix: m[1], value, suffix: m[3] };
      }

      function formatNumber(value, withDecimal) {
        if (withDecimal) {
          return value.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
        }
        return Math.round(value).toLocaleString();
      }

      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
      const enterDuration = 0.4 + (style.motion - 1) * 0.08;
      const blockDuration = 0.42 + (style.motion - 1) * 0.05;
      const wordDuration = 0.32 + (style.motion - 1) * 0.04;

      const blocks = frame.querySelectorAll(
        ".sl-meta,.sl-top,.sl-body,.sl-footer,.metric-card,.note-card,.map-card,.persona-card,.hn-card,.check-item,.cta-panel,.watch-chip,.pill,.tip-list li,.code-block,.copy-section,.s1-badge,.s1-sub"
      );
      const bars = frame.querySelectorAll(".sl-accent-line,.s-val-accent-bar,.sl-page-fill,.sl-progress-fill");
      const words = collectWordTargets();
      const lights = frame.querySelectorAll(".hf-light");
      const counters = frame.querySelectorAll(".metric-stars,.hn-chip strong,.map-num,.s1-number,.sl-page span,.slide-counter");
      const chips = frame.querySelectorAll(".watch-chip,.pill,.tip-icon,.check-icon,.sl-kicker,.sl-date");

      tl.fromTo(
        frame,
        { opacity: 0, y: style.enterYOffset, scale: 1.035, filter: "blur(" + style.enterBlur + "px)" },
        { opacity: 1, y: 0, scale: 1, filter: "blur(0px)", duration: enterDuration, ease: "power3.out" },
        0
      );

      if (lights.length) {
        tl.fromTo(
          lights[0],
          { opacity: 0, xPercent: -100, yPercent: -20, rotate: -18 },
          { opacity: 0.75 * style.lights, xPercent: 95, yPercent: 10, rotate: 8, duration: duration * 0.78, ease: "sine.inOut" },
          0.02
        );
      }
      if (lights.length > 1) {
        tl.fromTo(
          lights[1],
          { opacity: 0, xPercent: 100, yPercent: 30, rotate: 20 },
          { opacity: 0.6 * style.lights, xPercent: -90, yPercent: -24, rotate: -14, duration: duration * 0.82, ease: "sine.inOut" },
          0.09
        );
      }
      if (lights.length > 2) {
        tl.fromTo(
          lights[2],
          { opacity: 0, xPercent: 0, yPercent: 70 },
          { opacity: 0.45 * style.lights, xPercent: 0, yPercent: -85, duration: duration * 0.76, ease: "sine.inOut" },
          0.15
        );
      }

      if (bars.length) {
        tl.fromTo(
          bars,
          { scaleX: 0, transformOrigin: "0% 50%", opacity: 0.2 },
          { scaleX: 1, opacity: 1, duration: 0.36, stagger: 0.05, ease: "power2.out" },
          0.12
        );
      }

      if (blocks.length) {
        tl.from(
          blocks,
          { opacity: 0, y: 22 * style.motion, filter: "blur(6px)", duration: blockDuration, stagger: style.blockStagger, ease: "power2.out" },
          0.14
        );
      }

      if (words.length) {
        tl.from(
          words,
          {
            opacity: 0,
            y: 16 * style.motion,
            rotateX: -48,
            transformOrigin: "50% 100%",
            duration: wordDuration,
            stagger: style.wordStagger,
            ease: "power2.out",
          },
          0.2
        );
      }

      if (chips.length) {
        tl.fromTo(
          chips,
          { scale: 0.92, opacity: 0.5 },
          { scale: 1, opacity: 1, duration: 0.32, stagger: 0.02, ease: "back.out(1.7)" },
          0.28
        );
      }

      counters.forEach((el, idx) => {
        const parsed = parseCounterText(el.textContent || "");
        if (!parsed) return;
        const isDecimal = !Number.isInteger(parsed.value);
        const state = { n: 0 };
        const startAt = 0.27 + idx * 0.04;
        tl.to(
          state,
          {
            n: parsed.value,
            duration: Math.min(0.95, Math.max(0.45, duration * 0.42)),
            ease: "power2.out",
            onUpdate: () => {
              el.textContent = parsed.prefix + formatNumber(state.n, isDecimal) + parsed.suffix;
            },
            onComplete: () => {
              el.textContent = parsed.prefix + formatNumber(parsed.value, isDecimal) + parsed.suffix;
            },
          },
          startAt
        );
      });

      tl.to(frame, { scale: style.zoom, duration: duration, ease: "none" }, 0);

      tl.to(
        frame,
        { opacity: 0, y: -style.exitYOffset, scale: 0.985, filter: "blur(" + style.exitBlur + "px)", duration: 0.34, ease: "power2.in" },
        exitStart
      );
      tl.set(frame, { opacity: 0, visibility: "hidden" }, duration);

      window.__timelines["${slideCompId}"] = tl;
`;
}

async function run(cmd, args, cwd) {
  await new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      stdio: "inherit",
      env: process.env,
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${cmd} ${args.join(" ")} failed with exit code ${code}`));
      }
    });
  });
}

function pickSourceStageClass(styles) {
  if (/\.export-frame\s+\.slide/.test(styles)) {
    return "source-stage export-frame";
  }
  if (/\.cr-phone\b/.test(styles)) {
    return "source-stage cr-phone";
  }
  if (/\.slide-track\b/.test(styles)) {
    return "source-stage slide-track";
  }
  return "source-stage";
}

async function main() {
  const { input, opts } = parseArgs(process.argv.slice(2));

  if (opts.promptFile) {
    const promptPath = path.resolve(process.cwd(), opts.promptFile);
    opts.prompt = (await fs.readFile(promptPath, "utf8")).trim();
  }

  const inputAbs = path.resolve(process.cwd(), input);
  const inputDir = path.dirname(inputAbs);
  const inputBaseName = path.basename(inputAbs, path.extname(inputAbs));

  const outputAbs = opts.output
    ? path.resolve(process.cwd(), opts.output)
    : path.join(inputDir, `${inputBaseName}_reel.mp4`);

  const html = await fs.readFile(inputAbs, "utf8");
  const $ = cheerio.load(html, { decodeEntities: false });

  const styles = $("style")
    .toArray()
    .map((node) => $(node).html() || "")
    .join("\n\n");

  const slides = $(".slide")
    .toArray()
    .filter((node) => $(node).parents(".slide").length === 0);

  if (slides.length === 0) {
    throw new Error(`No .slide elements found in ${inputAbs}`);
  }

  const inferred = detectDimensions(styles);
  const width = opts.width != null ? even(opts.width) : inferred.width;
  const height = opts.height != null ? even(opts.height) : inferred.height;

  const sourceStageClass = pickSourceStageClass(styles);
  const styleSpec = deriveStyleSpec(opts.prompt);
  const secondsPerSlide = opts.secondsPerSlide;
  const totalDuration = Number((slides.length * secondsPerSlide).toFixed(3));

  await fs.rm(workDir, { recursive: true, force: true });
  await fs.mkdir(compositionsDir, { recursive: true });

  const compositionEntries = [];

  for (let i = 0; i < slides.length; i += 1) {
    const slideNode = slides[i];
    const slideCompId = `slide-${String(i + 1).padStart(2, "0")}`;
    const frameId = `frame-${String(i + 1).padStart(2, "0")}`;

    const root = $(slideNode).clone();
    const cleanClass = stripSlideStateClasses(root.attr("class") || "");
    if (cleanClass) {
      root.attr("class", cleanClass);
    } else {
      root.removeAttr("class");
    }

    root.removeAttr("data-start");
    root.removeAttr("data-duration");
    root.removeAttr("data-track-index");

    const slideHtml = $.html(root) || "";
    const slideScript = buildSlideAnimationScript(frameId, slideCompId, secondsPerSlide, styleSpec);

    const compositionHtml = `<template id="${slideCompId}-template">
  <div
    id="${slideCompId}-root"
    data-composition-id="${slideCompId}"
    data-start="0"
    data-duration="${secondsPerSlide}"
    data-width="${width}"
    data-height="${height}"
  >
    <div id="${frameId}" class="slide-wrap">
      <div class="hf-light hf-light-a"></div>
      <div class="hf-light hf-light-b"></div>
      <div class="hf-light hf-light-c"></div>
      <div class="${sourceStageClass}">
${slideHtml
  .split("\n")
  .map((line) => `        ${line}`)
  .join("\n")}
      </div>
    </div>

    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"><\/script>
    <script>
${slideScript
  .split("\n")
  .map((line) => `      ${line}`)
  .join("\n")}
    <\/script>
  </div>
</template>
`;

    const compositionPath = path.join(compositionsDir, `${slideCompId}.html`);
    await fs.writeFile(compositionPath, compositionHtml, "utf8");

    const startTime = Number((i * secondsPerSlide).toFixed(3));
    compositionEntries.push(
      `      <div id="clip-${i + 1}" data-composition-id="${slideCompId}" data-composition-src="compositions/${slideCompId}.html" data-start="${startTime}" data-track-index="0"></div>`,
    );
  }

  const rootHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${width}, height=${height}" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
${styles
  .split("\n")
  .map((line) => `      ${line}`)
  .join("\n")}

      * {
        box-sizing: border-box;
      }

      html,
      body {
        margin: 0;
        width: ${width}px;
        height: ${height}px;
        overflow: hidden;
        background: #000;
      }

      [data-composition-id="reel-root"] {
        position: relative;
        width: ${width}px;
        height: ${height}px;
        overflow: hidden;
        background: #000;
      }

      .slide-wrap {
        position: absolute;
        inset: 0;
        overflow: hidden;
        isolation: isolate;
      }

      .hf-light {
        position: absolute;
        pointer-events: none;
        mix-blend-mode: screen;
        opacity: 0;
        z-index: 40;
        will-change: transform, opacity;
      }

      .hf-light-a {
        width: 64%;
        height: 72%;
        top: -10%;
        left: -12%;
        border-radius: 50%;
        background: radial-gradient(circle at 45% 45%, rgba(255,255,255,0.48), rgba(120,220,255,0.24) 38%, rgba(20,20,30,0) 72%);
        filter: blur(10px);
      }

      .hf-light-b {
        width: 58%;
        height: 66%;
        right: -18%;
        bottom: -20%;
        border-radius: 52% 48% 60% 40%;
        background: radial-gradient(circle at 35% 35%, rgba(255,236,170,0.42), rgba(255,110,180,0.2) 40%, rgba(20,20,30,0) 76%);
        filter: blur(13px);
      }

      .hf-light-c {
        width: 130%;
        height: 24%;
        left: -15%;
        top: 36%;
        border-radius: 999px;
        background: linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,0.34), rgba(255,255,255,0));
        filter: blur(9px);
      }

      .source-stage {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        max-width: none !important;
        max-height: none !important;
        margin: 0 !important;
        aspect-ratio: auto !important;
        border-radius: 0 !important;
        overflow: hidden;
      }

      .source-stage:not(.export-frame) > .slide {
        position: absolute !important;
        inset: 0 !important;
        width: 100% !important;
        height: 100% !important;
      }

      .slide,
      .slide.active,
      .slide.exit,
      .slide.out {
        opacity: 1 !important;
        transform: none !important;
        transition: none !important;
        pointer-events: auto !important;
      }

      .hf-word {
        display: inline-block;
        will-change: transform, opacity;
      }
    </style>
  </head>
  <body>
    <div
      id="root"
      data-composition-id="reel-root"
      data-start="0"
      data-duration="${totalDuration}"
      data-width="${width}"
      data-height="${height}"
    >
${compositionEntries.join("\n")}
    </div>

    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
      tl.to({}, { duration: ${totalDuration} }, 0);
      window.__timelines["reel-root"] = tl;
    </script>
  </body>
</html>
`;

  await fs.writeFile(path.join(workDir, "index.html"), rootHtml, "utf8");
  await fs.writeFile(
    path.join(workDir, "meta.json"),
    JSON.stringify(
      {
        generatedFrom: inputAbs,
        prompt: opts.prompt || "",
        styleSpec,
        slides: slides.length,
        width,
        height,
        secondsPerSlide,
        totalDuration,
        generatedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    "utf8",
  );

  console.log(`Input file:      ${inputAbs}`);
  console.log(`Detected slides: ${slides.length}`);
  console.log(`Resolution:      ${width}x${height} (${inferred.reason}${opts.width || opts.height ? ", overridden by flags" : ""})`);
  console.log(`Duration:        ${totalDuration}s (${secondsPerSlide}s per slide)`);
  console.log(`Style profile:   ${styleSpec.profile}${opts.prompt ? " (from prompt)" : " (default)"}`);
  if (opts.prompt) {
    console.log(`Prompt:          ${opts.prompt}`);
  }
  console.log(`Workspace:       ${workDir}`);

  if (opts.noRender) {
    console.log("Skipped rendering (--no-render). You can render manually with:");
    console.log(`  cd ${workDir}`);
    console.log(`  npx hyperframes render --output ${outputAbs} --fps ${opts.fps} --quality ${opts.quality}`);
    return;
  }

  const npxCmd = process.platform === "win32" ? "npx.cmd" : "npx";

  console.log("\nRunning HyperFrames doctor...");
  await run(npxCmd, ["hyperframes", "doctor"], workDir);

  console.log("\nRendering MP4...");
  await run(
    npxCmd,
    [
      "hyperframes",
      "render",
      "--output",
      outputAbs,
      "--fps",
      String(opts.fps),
      "--quality",
      opts.quality,
    ],
    workDir,
  );

  console.log(`\nDone. Video created at: ${outputAbs}`);
}

main().catch((error) => {
  console.error(`\nError: ${error.message}`);
  process.exit(1);
});
