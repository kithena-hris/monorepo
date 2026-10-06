function buildPage({plat, cat, cats, comps, esc}){
const M=plat==='Mobile';
const file=(p,c)=>`Reach%20${p}%20${c}.dc.html`;
const other=M?'Web':'Mobile';
const nStories=comps.reduce((a,c)=>a+c.stories.length,0);
const slug=s=>s.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
const navLink=(href,label,on)=>`<a href="${href}" style="font: ${on?600:500} 14px/1 var(--r-font); color: ${on?'var(--r-fg)':'var(--r-fg-2)'}; background: ${on?'var(--r-fill)':'transparent'}; padding: 9px 12px; border-radius: 999px; white-space: nowrap; text-decoration: none;" style-hover="background: var(--r-fill); color: var(--r-fg);">${label}</a>`;
const header=`<header style="position: sticky; top: 0; z-index: 50; background: var(--r-glass); -webkit-backdrop-filter: saturate(180%) blur(20px); backdrop-filter: saturate(180%) blur(20px); border-bottom: 1px solid var(--r-glass-line);">
  <div style="max-width: 1480px; margin: 0 auto; padding: 0 clamp(16px, 3vw, 32px); height: 64px; display: flex; align-items: center; gap: 20px;">
    <a href="Reach%20${plat}.dc.html" style="display: flex; align-items: center; gap: 10px; color: var(--r-fg); text-decoration: none; flex: none;"><svg width="28" height="28" viewBox="0 0 32 32" fill="none"><rect width="32" height="32" rx="9" style="fill: var(--r-accent)"></rect><g transform="translate(4 4)" stroke="#fff" stroke-width="2.8" stroke-linecap="round"><path d="M6 20 V13 C6 8 10 4.6 14.2 6.2"></path><circle cx="18.5" cy="7.8" r="2.1" fill="#fff" stroke="none"></circle></g></svg><span style="font: 700 17px/1 var(--r-font-display); letter-spacing: -0.01em;">Reach</span><span style="font: 500 12px/1 var(--r-font); color: var(--r-fg-2); background: var(--r-fill); padding: 5px 8px; border-radius: 999px;">${plat} library</span></a>
    <nav style="display: flex; gap: 2px; overflow-x: auto; flex: 1; min-width: 0; scrollbar-width: none;">${navLink(`Reach%20${plat}.dc.html`,'Overview',false)}${cats.map(c=>navLink(file(plat,c),c,c===cat)).join('')}</nav>
    <div style="display: flex; padding: 3px; background: var(--r-fill); border-radius: 999px; flex: none;">${['Web','Mobile'].map(p=>p===plat?`<span style="height: 30px; padding: 0 12px; border-radius: 999px; display: flex; align-items: center; font: 600 13px/1 var(--r-font); background: var(--r-surface-raised); color: var(--r-fg); box-shadow: var(--r-shadow-1);">${p}</span>`:`<a href="${file(p,cat)}" style="height: 30px; padding: 0 12px; border-radius: 999px; display: flex; align-items: center; font: 600 13px/1 var(--r-font); color: var(--r-fg-2); text-decoration: none;" style-hover="color: var(--r-fg);">${p}</a>`).join('')}</div>
    <div style="display: flex; padding: 3px; background: var(--r-fill); border-radius: 999px; flex: none;">
      <button onClick="{{ setLight }}" aria-label="Light mode" style="width: 34px; height: 30px; border: 0; border-radius: 999px; cursor: pointer; font-size: 16px; display: grid; place-items: center; background: {{ lightBg }}; color: {{ lightFg }}; box-shadow: {{ lightShadow }};"><i class="icon-sun"></i></button>
      <button onClick="{{ setDark }}" aria-label="Dark mode" style="width: 34px; height: 30px; border: 0; border-radius: 999px; cursor: pointer; font-size: 16px; display: grid; place-items: center; background: {{ darkBg }}; color: {{ darkFg }}; box-shadow: {{ darkShadow }};"><i class="icon-moon"></i></button>
    </div>
  </div>
</header>`;
const groups=[];comps.forEach(c=>{let g=groups.find(x=>x.g===c.g);if(!g){g={g:c.g,items:[]};groups.push(g);}g.items.push(c);});
const aside=`<aside style="flex: 0 0 210px; position: sticky; top: 88px; max-height: calc(100vh - 110px); overflow-y: auto; scrollbar-width: thin; padding-bottom: 24px;">${groups.map(g=>`<div style="font: 600 12px/1 var(--r-font); color: var(--r-fg-3); padding: 18px 10px 8px;">${esc(g.g)}</div>${g.items.map(c=>`<a href="#${c.id}" style="display: flex; justify-content: space-between; gap: 8px; font: 500 14px/1 var(--r-font); color: var(--r-fg-2); padding: 8px 10px; border-radius: 10px; text-decoration: none;" style-hover="background: var(--r-fill); color: var(--r-fg);"><span style="display: flex; align-items: center; gap: 6px;">${esc(c.name)}${c.isNew?'<span style="width: 6px; height: 6px; border-radius: 999px; background: var(--r-accent);"></span>':''}</span><span style="color: var(--r-fg-3); font-size: 12px;">${c.stories.length}</span></a>`).join('')}`).join('')}</aside>`;
const storyW=(c,[t,html,o={}])=>`<div id="${c.id}-${slug(t)}" style="${o.wide?'grid-column: 1 / -1; ':''}background: var(--r-surface); border-radius: 24px; box-shadow: var(--r-shadow-1); overflow: hidden; display: flex; flex-direction: column; min-width: 0;">
<div style="padding: 14px 20px; display: flex; align-items: center; justify-content: space-between; gap: 12px; box-shadow: inset 0 -1px 0 var(--r-line);"><span style="font: 600 15px/1.3 var(--r-font);">${esc(t)}</span></div>
<div style="padding: 24px; background: var(--r-bg); flex: 1; min-width: 0;">${html}</div>${o.note?`<div style="padding: 12px 20px; font: 400 13px/1.5 var(--r-font); color: var(--r-fg-2); box-shadow: inset 0 1px 0 var(--r-line); text-wrap: pretty;">${esc(o.note)}</div>`:''}</div>`;
const storyM=(c,[t,html,o={}])=>`<div id="${c.id}-${slug(t)}" style="width: 390px; max-width: 100%; flex: none; display: flex; flex-direction: column; gap: 10px;">
<div style="padding: 0 8px; display: flex; flex-direction: column; gap: 4px;"><span style="font: 600 14px/1.3 var(--r-font);">${esc(t)}</span>${o.note?`<span style="font: 400 13px/1.45 var(--r-font); color: var(--r-fg-2); text-wrap: pretty;">${esc(o.note)}</span>`:''}</div>
<div style="background: var(--r-bg); border-radius: 36px; box-shadow: var(--r-shadow-3), inset 0 0 0 1px var(--r-line); padding: 20px 16px; box-sizing: border-box; min-width: 0;">${html}</div></div>`;
const section=c=>`<section id="${c.id}" data-screen-label="${esc(c.name)}" style="padding-top: 72px;">
<div style="font: 600 14px/1 var(--r-font); color: var(--r-accent-text); margin-bottom: 10px;">${esc(c.g)}</div>
<h2 style="margin: 0; font: 700 clamp(28px, 3.4vw, 40px)/1.08 var(--r-font-display); letter-spacing: -0.03em; display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">${esc(c.name)}${c.isNew?'<span style="font: 600 13px/1 var(--r-font); letter-spacing: 0; color: var(--r-accent-text); background: var(--r-accent-soft); padding: 6px 10px; border-radius: 999px;">New</span>':''}</h2>
<p style="margin: 12px 0 0; font: 400 16px/1.55 var(--r-font); color: var(--r-fg-2); max-width: 640px; text-wrap: pretty;">${esc(c.desc)}</p>
${M?`<div style="margin-top: 28px; display: flex; flex-wrap: wrap; gap: 28px; align-items: flex-start;">${c.stories.map(s=>storyM(c,s)).join('\n')}</div>`:`<div style="margin-top: 28px; display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 440px), 1fr)); gap: 16px; align-items: start;">${c.stories.map(s=>storyW(c,s)).join('\n')}</div>`}
</section>`;
const tpl=`<helmet>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="reach-tokens.css">
<link rel="stylesheet" href="https://unpkg.com/lucide-static@0.460.0/font/lucide.css">
<style>
@keyframes rspin { to { transform: rotate(360deg) } }
@keyframes rshimmer { 0% { background-position: -400px 0 } 100% { background-position: 400px 0 } }
@keyframes rindet { 0% { transform: translateX(-100%) } 100% { transform: translateX(250%) } }
@keyframes rpulse { 0%, 100% { opacity: 1 } 50% { opacity: 0.35 } }
@keyframes rrace { 0%, 15% { left: 4px } 85%, 100% { left: calc(100% - 24px) } }
html { scroll-behavior: smooth; scroll-padding-top: 80px; }
</style>
</helmet>
${header}
<div style="max-width: 1480px; margin: 0 auto; padding: 0 clamp(16px, 3vw, 32px) 120px; color: var(--r-fg);">
<section id="top" data-screen-label="Intro" style="padding: clamp(48px, 7vw, 96px) 0 8px;">
<div style="font: 600 15px/1 var(--r-font); color: var(--r-accent-text); margin-bottom: 16px;">Reach ${plat} · Library</div>
<h1 style="margin: 0; font: 700 clamp(40px, 6vw, 72px)/1 var(--r-font-display); letter-spacing: -0.04em;">${esc(cat)}</h1>
<p style="margin: 20px 0 0; font: 400 18px/1.5 var(--r-font); color: var(--r-fg-2); max-width: 660px; text-wrap: pretty;">All ${comps.length} components and ${nStories} variants: everything from Storybook, plus ${comps.filter(c=>c.isNew).length} new standard components (marked with a dot), redrawn in the new system${M?' at phone size (390pt) with mobile type and touch targets':' at desktop density'}. Every one works in light and dark mode.</p>
</section>
<div style="display: flex; gap: 40px; align-items: flex-start;">
${aside}
<main style="flex: 1 1 600px; min-width: 0;">
${comps.map(section).join('\n')}
</main>
</div>
</div>`;
const js=`class Component extends DCLogic {
  state = { theme: null };
  componentDidMount() { try { const t = localStorage.getItem('reach-ds-theme'); if (t) this.setState({ theme: t }); } catch (e) {} this.apply(); }
  componentDidUpdate() { this.apply(); }
  theme() { return this.state.theme ?? this.props.theme ?? 'dark'; }
  apply() { document.documentElement.setAttribute('data-theme', this.theme()); }
  set(t) { try { localStorage.setItem('reach-ds-theme', t); } catch (e) {} this.setState({ theme: t }); }
  renderVals() {
    const t = this.theme();
    const on = { bg: 'var(--r-surface-raised)', fg: 'var(--r-fg)', sh: 'var(--r-shadow-1)' }, off = { bg: 'transparent', fg: 'var(--r-fg-2)', sh: 'none' };
    const L = t === 'light' ? on : off, D = t === 'dark' ? on : off;
    return { setLight: () => this.set('light'), setDark: () => this.set('dark'), lightBg: L.bg, lightFg: L.fg, lightShadow: L.sh, darkBg: D.bg, darkFg: D.fg, darkShadow: D.sh };
  }
}`;
const props='{&quot;theme&quot;: {&quot;editor&quot;: &quot;enum&quot;, &quot;options&quot;: [&quot;dark&quot;, &quot;light&quot;], &quot;default&quot;: &quot;dark&quot;, &quot;tsType&quot;: &quot;\'dark\'|\'light\'&quot;}}';
return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<script src="./support.js"></script>
</head>
<body>
<x-dc>
${tpl}
</x-dc>
<script type="text/x-dc" data-dc-script data-props="${props}">
${js}
</script>
</body>
</html>
`;}
