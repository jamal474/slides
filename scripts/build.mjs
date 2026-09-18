#!/usr/bin/env node
/**
 * Builds every Markdown deck in src/ into a standalone deckrun HTML page in dist/.
 *
 * The output is byte-identical to the editor's "export → HTML / Presenter Page":
 * one self-contained file that opens as a slide deck (arrows, overview, fullscreen,
 * laser pointer, pen). Fonts, highlight.js, KaTeX and Mermaid load from CDNs.
 *
 * Per-deck options live in an HTML comment on the first slide, for example:
 *   <!-- deckrun: theme=midnight template=classic transition=slide -->
 * Anything not set there falls back to the DEFAULTS below.
 */
import { readdir, readFile, mkdir, writeFile, rm } from "node:fs/promises";
import { join, relative, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { parseSlides } from "deckrun/dist/parser.js";
import { generateHtml } from "deckrun/dist/generate.js";
import { lintMarkdown } from "deckrun/dist/lint.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");
const OUT = join(ROOT, "dist");

const DEFAULTS = {
  theme: "midnight",       // deckrun --list-themes
  template: "classic",     // classic | minimal | editorial | spotlight
  transition: "slide",     // slide | fade | zoom | lift | none
  head: null,              // heading font override, e.g. playfair
  body: null,              // body font override, e.g. lora
  title: null              // defaults to the first heading of the deck
};

const OPTION_RE = /<!--\s*deckrun:\s*([^>]*?)\s*-->/i;

function optionsFor(markdown) {
  const opts = { ...DEFAULTS };
  const match = markdown.match(OPTION_RE);
  if (!match) return opts;
  for (const pair of match[1].split(/\s+/).filter(Boolean)) {
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    const key = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (key in opts) opts[key] = value;
  }
  return opts;
}

function deckTitle(slides, fallback) {
  const heading = slides[0]?.html.match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i);
  const text = heading ? heading[1].replace(/<[^>]+>/g, "").trim() : "";
  return text || fallback;
}

async function markdownFiles(dir) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await markdownFiles(full)));
    else if (entry.name.endsWith(".md")) found.push(full);
  }
  return found.sort();
}

/**
 * Renders one standalone page.
 *
 * deckrun's generateHtml has had two shapes: with and without the `size`
 * argument before `fonts`. Passing the wrong one silently drops the options
 * object, and the page comes out linking /__vendor/ assets instead of CDNs.
 * So: try the current shape, and fall back to the older one if the telltale
 * /__vendor/ link shows up.
 */
/** deckrun drops three animated pixel pets along the bottom edge of a presented
 * deck, fetched from GitHub at view time. Take them out of the published page. */
function removePets(html) {
  const stripped = html.replace(/\(function spawnPets\(\) \{[\s\S]*?\n\s*\}\)\(\);/, "");
  return stripped.includes("vscode-pets") ? html : stripped;
}

function buildStandalone(slides, title, opts) {
  const fonts = { head: opts.head, body: opts.body };
  const presentation = { template: opts.template, transition: opts.transition, standalone: true };

  const withSize = generateHtml(slides, title, false, opts.theme, undefined, fonts, presentation);
  if (!withSize.includes("/__vendor/")) return removePets(withSize);

  return removePets(generateHtml(slides, title, false, opts.theme, fonts, presentation));
}

const strict = !process.argv.includes("--no-strict");
const files = await markdownFiles(SRC);
if (files.length === 0) {
  console.error("no .md files found in src/");
  process.exit(1);
}

await rm(OUT, { recursive: true, force: true });
let failed = 0;

for (const file of files) {
  const rel = relative(SRC, file);
  const markdown = await readFile(file, "utf8");

  const lint = lintMarkdown(markdown);
  const problems = lint.problems ?? lint.messages ?? [];
  const errors = problems.filter((p) => p.severity === "error");
  const warnings = problems.filter((p) => p.severity !== "error");
  for (const p of problems) {
    console.log(`  ${p.severity === "error" ? "✖" : "⚠"} ${rel}:${p.line ?? 0} ${p.message}`);
  }
  if (errors.length) {
    failed++;
    continue;
  }

  const slides = parseSlides(markdown);
  if (slides.length === 0) {
    console.log(`  ✖ ${rel} has no slides`);
    failed++;
    continue;
  }

  const opts = optionsFor(markdown);
  const title = opts.title || deckTitle(slides, rel.replace(/\.md$/, ""));
  const html = buildStandalone(slides, title, opts);

  // A standalone page must carry no /__vendor/ links: those only resolve on a
  // running deckrun server, and a published page would show its Mermaid
  // diagrams and equations as raw source instead of rendering them.
  if (html.includes("/__vendor/")) {
    console.error(`  \u2716 ${rel}: built page still links /__vendor/ assets — deckrun's generateHtml signature has changed again.`);
    failed++;
    continue;
  }

  const outPath = join(OUT, rel.replace(/\.md$/, ".html"));
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, html, "utf8");
  console.log(`  ✓ ${rel} → dist${sep}${relative(OUT, outPath)}  (${slides.length} slides, ${warnings.length} warnings, theme ${opts.theme})`);
}

if (failed) {
  console.error(`\n${failed} deck(s) failed to build.`);
  process.exit(1);
}
console.log(`\nbuilt ${files.length} deck(s) into dist/`);
