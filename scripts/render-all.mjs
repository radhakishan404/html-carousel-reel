#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");

function usage() {
  console.log(`Usage:
  node scripts/render-all.mjs [--dir ./html-carousel] [--prompt "cinematic fast"] [--seconds-per-slide 3.6] [--fps 30] [--quality standard]

Examples:
  npm run render:all
  npm run render:all -- --prompt "cinematic neon" --seconds-per-slide 3.2
`);
}

function parse(argv) {
  if (argv.includes("-h") || argv.includes("--help")) {
    usage();
    process.exit(0);
  }

  const opts = {
    dir: "./html-carousel",
    forward: [],
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dir") {
      const value = argv[i + 1];
      if (!value) throw new Error("Missing value for --dir");
      opts.dir = value;
      i += 1;
      continue;
    }
    opts.forward.push(arg);
  }

  return opts;
}

async function run(cmd, args, cwd) {
  await new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: "inherit", env: process.env });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(" ")} failed with code ${code}`));
    });
  });
}

async function main() {
  const opts = parse(process.argv.slice(2));
  const inputDir = path.resolve(process.cwd(), opts.dir);
  const entries = await fs.readdir(inputDir, { withFileTypes: true });
  const htmlFiles = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".html"))
    .map((entry) => path.join(inputDir, entry.name))
    .sort((a, b) => a.localeCompare(b));

  if (htmlFiles.length === 0) {
    throw new Error(`No .html files found in ${inputDir}`);
  }

  const nodeCmd = process.execPath;

  for (const file of htmlFiles) {
    console.log(`\n=== Rendering: ${file} ===`);
    await run(nodeCmd, ["./scripts/render-carousel-reel.mjs", file, ...opts.forward], root);
  }

  console.log("\nAll renders complete.");
}

main().catch((error) => {
  console.error(`\nError: ${error.message}`);
  process.exit(1);
});
