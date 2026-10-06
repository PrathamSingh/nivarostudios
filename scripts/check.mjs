#!/usr/bin/env node
/**
 * Pre-push checks for the site.
 *
 * Written after shipping a stray `">` to the live homepage: a regex that
 * removed the old data-URI favicon stopped at the first `>` *inside* the URI
 * and left the rest of the SVG as document text. Tag balance was still
 * perfect, so the HTML parser check passed and the screenshot was too small
 * to read. Nothing caught it except a visitor.
 *
 *   npm run check
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const fail = [];

const pages = [];
const walk = (dir) => {
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'scripts') continue;
    const rel = dir ? `${dir}/${e.name}` : e.name;
    if (e.isDirectory()) walk(rel);
    else if (extname(e.name) === '.html') pages.push(rel);
  }
};
walk('');

for (const page of pages) {
  const html = readFileSync(join(ROOT, page), 'utf8');
  const body = html.slice(html.indexOf('<body'));

  /*
   * Markup fragments loose in the document. An orphaned tag is one that
   * appears at the start of a line outside any element it belongs to — the
   * shape the broken favicon left behind.
   */
  for (const tag of ['defs', 'linearGradient', 'rect', 'path', 'stop', 'circle']) {
    if (new RegExp(`^<${tag}[\\s>]`, 'm').test(html)) {
      fail.push(`${page}: orphaned <${tag}> at the start of a line`);
    }
  }
  if (/^[^<\n]*"\s*>/m.test(html.split('<body')[0].replace(/<[^>]*>/g, ''))) {
    fail.push(`${page}: stray quote-and-bracket in <head> — a truncated tag`);
  }

  // Every page carries the same head contract.
  for (const [what, re] of [
    ['canonical', /rel="canonical"/],
    ['og:title', /property="og:title"/],
    ['favicon', /rel="icon"/],
    ['manifest', /rel="manifest"/],
    ['CSP', /Content-Security-Policy/],
  ]) {
    if (!re.test(html)) fail.push(`${page}: missing ${what}`);
  }

  // The CSP is strict, so these are silently blocked rather than loudly broken.
  if (/\sstyle="/.test(body)) fail.push(`${page}: inline style attribute — blocked by the CSP`);
  if (/\.style\.[a-zA-Z]+\s*=/.test(body)) fail.push(`${page}: JS writes el.style — blocked by the CSP`);

  // frame-ancestors cannot be delivered by a meta element.
  if (/Content-Security-Policy[^>]*frame-ancestors/.test(html)) {
    fail.push(`${page}: frame-ancestors in a meta CSP is ignored by the browser`);
  }

  // Relative og:image is the usual reason a preview fails to render.
  const og = html.match(/property="og:image" content="([^"]+)"/);
  if (og && !og[1].startsWith('https://')) fail.push(`${page}: og:image is not absolute`);

  // Links that open a new tab need noopener, or the opened page can rewrite this one.
  for (const m of html.matchAll(/<a\b[^>]*target="_blank"[^>]*>/g)) {
    if (!m[0].includes('noopener')) fail.push(`${page}: target="_blank" without rel="noopener"`);
  }
}

for (const f of ['sitemap.xml', 'robots.txt', 'manifest.json', 'og-image.png',
                 'favicon.svg', 'favicon.png', 'apple-touch-icon.png']) {
  if (!existsSync(join(ROOT, f))) fail.push(`missing file: ${f}`);
}
JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));

// Every sitemap URL must point at a file that exists.
for (const m of readFileSync(join(ROOT, 'sitemap.xml'), 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)) {
  const rel = m[1].replace('https://nivarostudios.com/', '') || 'index.html';
  if (!existsSync(join(ROOT, rel))) fail.push(`sitemap lists a missing page: ${rel}`);
}

console.log(`checked ${pages.length} pages`);
if (fail.length) {
  console.error(`\n${fail.length} problem(s):`);
  for (const f of fail) console.error(`  ${f}`);
  process.exit(1);
}
console.log('all checks passed');
