// Builds the Kithena Mobile v3 screens from the design sources and screenshots each one.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const dir = new URL('.', import.meta.url).pathname;
const files = ['core.js', 'people-core.js', 'people-ux.js', 'to-core.js', 'p2-core.js', 'm3.js'];
const src = files.map((f) => readFileSync(dir + f, 'utf8')).join('\n');
const F = new Function(src + '\nreturn {makeLib,makePeople,makeUX,TOC,P2C,M3};')();
const L = F.makeLib({ m: 1 });
const K = F.makePeople(L);
K.U = F.makeUX(L, K);
globalThis.__U = K.U;
const X = F.TOC(L, K);
const Q = F.P2C(L, K, X);
const screens = F.M3(L, K, X, Q);

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
const css = readFileSync(dir + 'reach-tokens.css', 'utf8');
const html = `<!doctype html><html data-theme="light"><head><meta charset="utf-8">
<link rel="stylesheet" href="https://unpkg.com/lucide-static@0.460.0/font/lucide.css">
<style>${css}
@keyframes rpulse{0%,100%{opacity:1}50%{opacity:.35}}
body{padding:24px;display:flex;flex-wrap:wrap;gap:40px;align-items:flex-start}</style></head><body>
${screens.map((s) => `<div class="s" id="${s.id}" style="width:390px"><b>${s.id} ${esc(s.title)}</b><p style="font:13px/1.4 sans-serif">${esc(s.note)}</p>${s.html}</div>`).join('\n')}
</body></html>`;
writeFileSync(dir + 'screens.html', html);
writeFileSync(dir + 'screens.json', JSON.stringify(screens.map(({ g, id, title, note }) => ({ g, id, title, note })), null, 1));

const require = createRequire(process.argv[2]);
const { chromium } = require('playwright');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 1 });
await page.goto('file://' + dir + 'screens.html');
await page.waitForTimeout(2500);
mkdirSync(dir + 'shots', { recursive: true });
for (const s of screens) await page.locator('#' + s.id).screenshot({ path: `${dir}shots/${s.id}.png` });
await browser.close();
console.log(screens.length);
