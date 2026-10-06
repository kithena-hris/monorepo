// Renders the Reach Mobile library pages from the design source, for reference.
const fs = require('fs'), path = require('path');
const src = f => fs.readFileSync(path.join(__dirname, f), 'utf8');
const fn = new Function(src('core.js') + src('page.js') + ['foundations','forms','components','data','charts','extra'].map(s => src(`spec-${s}.js`)).join('\n') +
  '\nreturn {makeLib, buildPage, SPEC_FOUNDATIONS, SPEC_FORMS, SPEC_COMPONENTS, SPEC_DATA, SPEC_CHARTS, SPEC_EXTRA};');
module.exports = fn();
if (require.main === module) {
  const x = module.exports; const L = x.makeLib({ m: 1 });
  const specs = { Foundations: x.SPEC_FOUNDATIONS, Forms: x.SPEC_FORMS, Components: x.SPEC_COMPONENTS, Data: x.SPEC_DATA, Charts: x.SPEC_CHARTS };
  const extra = x.SPEC_EXTRA(L);
  const all = {};
  for (const [cat, f] of Object.entries(specs)) all[cat] = f(L);
  for (const cat of ['Components', 'Forms', 'Data', 'Charts']) for (const c of extra[cat]) all[cat].push({ ...c, isNew: true });
  for (const [id, stories] of Object.entries(extra.extend)) for (const comps of Object.values(all)) { const c = comps.find(c => c.id === id); if (c) c.stories = c.stories.concat(stories); }
  for (const comps of Object.values(all)) comps.sort((a, b) => a.name.localeCompare(b.name));
  if (process.argv[2] === 'html') { const cats = Object.keys(all); for (const cat of cats) fs.writeFileSync(path.join(__dirname, '..', `Reach Mobile ${cat}.html`), x.buildPage({ plat: 'Mobile', cat, cats, comps: all[cat], esc: s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;') })); }
  for (const [cat, comps] of Object.entries(all)) console.log(cat, comps.length, comps.reduce((a, c) => a + c.stories.length, 0), comps.map(c => c.name).join(', '));
}

// Plain reference pages: one per category, every story in a 390pt phone frame.
if (require.main === module && process.argv[2] === 'ref') {
  const x = module.exports; const L = x.makeLib({ m: 1 });
  const all = {}; for (const [cat, f] of Object.entries({ Foundations: x.SPEC_FOUNDATIONS, Forms: x.SPEC_FORMS, Components: x.SPEC_COMPONENTS, Data: x.SPEC_DATA, Charts: x.SPEC_CHARTS })) all[cat] = f(L);
  const extra = x.SPEC_EXTRA(L);
  for (const cat of ['Components', 'Forms', 'Data', 'Charts']) for (const c of extra[cat]) all[cat].push({ ...c, isNew: true });
  for (const [id, stories] of Object.entries(extra.extend)) for (const comps of Object.values(all)) { const c = comps.find(c => c.id === id); if (c) c.stories = c.stories.concat(stories); }
  const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const index = {};
  fs.mkdirSync(path.join(__dirname, '..', 'ref'), { recursive: true });
  for (const [cat, comps] of Object.entries(all)) {
    index[cat] = comps.map(c => ({ id: c.id, name: c.name, group: c.g, desc: c.desc, isNew: !!c.isNew, stories: c.stories.map(([t, , o = {}]) => ({ title: t, anchor: `${c.id}-${slug(t)}`, note: o.note ?? null })) }));
    const body = comps.map(c => `<section id="${c.id}"><h2>${esc(c.name)}</h2><p class="d">${esc(c.desc)}</p><div class="row">${c.stories.map(([t, html, o = {}]) => `<figure id="${c.id}-${slug(t)}"><figcaption><b>${esc(t)}</b>${o.note ? `<span>${esc(o.note)}</span>` : ''}</figcaption><div class="phone">${html}</div></figure>`).join('')}</div></section>`).join('');
    for (const theme of ['light', 'dark'])
      fs.writeFileSync(path.join(__dirname, '..', 'ref', `${slug(cat)}-${theme}.html`), `<!doctype html><html data-theme="${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="../reach-tokens.css"><link rel="stylesheet" href="https://unpkg.com/lucide-static@0.460.0/font/lucide.css"><style>@keyframes rspin{to{transform:rotate(360deg)}}@keyframes rshimmer{0%{background-position:-400px 0}100%{background-position:400px 0}}@keyframes rindet{0%{transform:translateX(-100%)}100%{transform:translateX(250%)}}@keyframes rpulse{0%,100%{opacity:1}50%{opacity:.35}}@keyframes rrace{0%,15%{left:4px}85%,100%{left:calc(100% - 24px)}}body{padding:24px;font-family:var(--r-font)}h2{font:700 32px/1.1 var(--r-font-display);margin:56px 0 8px}.d{color:var(--r-fg-2);max-width:640px}.row{display:flex;flex-wrap:wrap;gap:28px;align-items:flex-start}figure{margin:0;width:390px;display:flex;flex-direction:column;gap:10px}figcaption{display:flex;flex-direction:column;gap:4px;padding:0 8px;font:400 13px/1.45 var(--r-font);color:var(--r-fg-2)}figcaption b{font:600 14px/1.3 var(--r-font);color:var(--r-fg)}.phone{background:var(--r-bg);border-radius:36px;box-shadow:var(--r-shadow-3),inset 0 0 0 1px var(--r-line);padding:20px 16px;box-sizing:border-box}</style></head><body><h1>Reach Mobile · ${esc(cat)}</h1>${body}</body></html>`);
  }
  fs.writeFileSync(path.join(__dirname, '..', 'ref', 'index.json'), JSON.stringify(index, null, 1));
  console.log('wrote ref/');
}
