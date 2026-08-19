/**
 * Contrast gate.
 *
 * Renders every story in both themes and both pointer profiles, measures the
 * real composited colour of every text node, icon and focus ring, and exits
 * non-zero if one is below its WCAG threshold.
 *
 * ### Why this runs next to axe rather than instead of it
 *
 * axe has three outcomes and only one of them fails a build. Its
 * colour-contrast rule returns *incomplete* whenever it cannot be certain what
 * it is looking at, and one of those cases is text it considers too short:
 *
 *     "Element content is too short to determine if it is actual text content"
 *
 * A step number, a badge count, a pagination digit and a set of avatar
 * initials are all "too short". None were checked across 372 stories, and a
 * stepper marker shipped at 1.31:1 with the suite green.
 *
 * ### What it does differently
 *
 * - Measures composited colour, walking up the ancestors and compositing every
 *   translucent layer, so a token on a wash is judged as it renders.
 * - Rasterises through a canvas, so oklch and any other colour space resolve to
 *   the sRGB bytes a person actually sees.
 * - Checks icons at the 3:1 of WCAG 1.4.11. A tick on a filled chip carries
 *   meaning the way a digit does, and a text-only sweep is blind to it: the
 *   first version of this file passed a green tick on green at 1.55:1 because
 *   the element held no text node.
 * - Honours the WCAG 1.4.3 exemption for inactive controls. Dimming a disabled
 *   field is correct, and raising it to 4.5:1 would make disabled look enabled.
 * - Measures focus rings, which are the indicator 1.4.11 is most often written
 *   about and the one no static check can see, since the colour only exists
 *   while an element is focused.
 * - Measures the chart palette at its source. Series colour comes from a closed
 *   union of six tones, so six readings cover every mark any chart can draw,
 *   including the ones no story renders.
 *
 * ### What it still does not cover
 *
 * The default state of each story. Hover, active, selected and invalid states
 * are not driven, so their colours are unmeasured. Anything behind an
 * interaction (an open menu, a populated combobox) is only seen if the story
 * opens it.
 *
 * Usage: start Storybook, then `pnpm a11y:contrast`.
 */
/*
 * eslint-disable no-await-in-loop
 *
 * Every `await` in a loop here drives one shared Playwright page or context:
 * navigate, wait for the theme to settle, read the computed values, move on.
 * The rule's suggested fix, collecting the promises and running `Promise.all`,
 * would have several navigations racing the same page and reading each other's
 * DOM, or spawn a browser per story. Sequential is the correct shape.
 */
/* eslint-disable no-await-in-loop */

import { chromium } from 'playwright';

const BASE = process.env.STORYBOOK_URL ?? 'http://localhost:6006';

/**
 * Runs inside the page. Passed as a function rather than a string: the browser
 * half of this file used to be a template literal, and every backtick and
 * `${}` in it had to be escaped, which is how a comment silently terminated
 * the program.
 */
/*
 * eslint-disable unicorn/consistent-function-scoping
 *
 * The helpers below deliberately live inside `measure`. This function is
 * handed to `page.evaluate` and re-created inside the browser, so it can only
 * call things declared within itself; hoisting them to module scope, which is
 * what the rule asks for, leaves them undefined in the page.
 */
/* eslint-disable unicorn/consistent-function-scoping */
function measure(options) {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  const rgb = (value) => {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = '#000';
    ctx.fillStyle = value;
    ctx.fillRect(0, 0, 1, 1);
    const data = ctx.getImageData(0, 0, 1, 1).data;
    return [data[0], data[1], data[2], data[3] / 255];
  };

  const luminance = ([r, g, b]) => {
    const channel = (x) => {
      const v = x / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  };

  const composite = (fg, bg) =>
    fg[3] >= 1
      ? fg
      : [0, 1, 2].map((i) => Math.round(fg[i] * fg[3] + bg[i] * (1 - fg[3]))).concat(1);

  const backgroundOf = (el) => {
    const chain = [];
    for (let node = el; node && node !== document.documentElement; node = node.parentElement) {
      chain.push(node);
    }
    chain.reverse();
    let acc = [255, 255, 255, 1];
    for (const node of chain) {
      const colour = rgb(getComputedStyle(node).backgroundColor);
      if (colour[3] > 0) acc = composite(colour, acc);
    }
    return acc;
  };

  const ratioOf = (fg, bg) => {
    const [hi, lo] = [luminance(fg), luminance(bg)].toSorted((a, b) => b - a);
    return (hi + 0.05) / (lo + 0.05);
  };

  const INACTIVE = ':disabled, [disabled], [aria-disabled="true"], [data-disabled]';

  /*
   * Storybook's own props table is out of scope.
   *
   * This gate exists to protect the design system. The args table and its JSON
   * tree control are Storybook's UI: they ship with the tool, not with
   * `@reach/ui`, and several of their colours are written as inline styles that
   * no stylesheet here can reach without `!important` on every node. Measuring
   * them produced thousands of findings that no change to this repo could fix,
   * which is the kind of noise that teaches people to ignore a gate.
   *
   * Everything the design system renders is still measured, including its
   * components inside `.docs-story` and the prose authored in MDX. The chrome
   * that surrounds them is not.
   */
  const FOREIGN = '.docblock-argstable, .rejt-tree';
  const findings = [];

  for (const svg of document.querySelectorAll('svg')) {
    // `data-decorative` is a component saying this shape carries no
    // information: a tooltip tail, a popover arrow. WCAG exempts those, and
    // they are indistinguishable from an icon by measurement alone, since both
    // are small monochrome SVG.
    if (svg.closest('.sr-only, [data-decorative]') || svg.closest(INACTIVE)) continue;
    const box = svg.getBoundingClientRect();
    // Icon-sized only. A chart, a sparkline and a progress ring are also SVG,
    // and their root paints nothing: the colour lives on children that each
    // mean something different, so reading the root's computed stroke reports
    // a number about no part of the picture. The first run of this check
    // flagged a 542px donut as a failing "icon".
    if (box.width < 4 || box.height < 4 || box.width > 32 || box.height > 32) continue;
    // Multi-colour graphics are out for the same reason, whatever their size.
    if (
      svg.querySelector(
        '[fill]:not([fill="none"]):not([fill="currentColor"]), [stroke]:not([stroke="none"]):not([stroke="currentColor"])',
      )
    ) {
      continue;
    }
    const styles = getComputedStyle(svg);
    if (styles.visibility === 'hidden' || styles.display === 'none') continue;
    if (Number(styles.opacity) < 0.35) continue;
    const painted = styles.stroke && styles.stroke !== 'none' ? styles.stroke : styles.fill;
    if (!painted || painted === 'none') continue;
    const bg = backgroundOf(svg.parentElement ?? svg);
    const ratio = ratioOf(composite(rgb(painted), bg), bg);
    if (ratio < 3) {
      findings.push({
        text: 'icon ' + Math.round(box.width) + 'px',
        ratio: Math.round(ratio * 100) / 100,
        need: 3,
        size: Math.round(box.width),
      });
    }
  }

  for (const el of document.querySelectorAll('*')) {
    if (el.closest('.sr-only, [aria-hidden="true"]') || el.closest(INACTIVE)) continue;
    if (el.closest(FOREIGN)) continue;
    const text = [...el.childNodes]
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent.trim())
      .join('');
    if (!text) continue;
    const styles = getComputedStyle(el);
    if (styles.visibility === 'hidden' || styles.display === 'none') continue;
    if (Number(styles.opacity) < 0.1) continue;
    const box = el.getBoundingClientRect();
    if (box.width < 2 || box.height < 2) continue;

    /*
     * Fully transparent text is not text anybody sees.
     *
     * Storybook lays an invisible button over each collapsible section of its
     * props table, carrying the label "Hide Data items" for a screen reader at
     * `color: rgba(0,0,0,0)`. Measuring the contrast of something with no
     * opacity asks a question with no answer, and it reported thousands of
     * exact 1:1 results across the docs pages. An icon at 1:1 is still a
     * finding: that one is painted, it just matches its background.
     */
    if (rgb(styles.color)[3] === 0) continue;

    const size = parseFloat(styles.fontSize);
    const bold = Number(styles.fontWeight) >= 700;
    const large = size >= 24 || (size >= 18.66 && bold);
    const bg = backgroundOf(el);
    const ratio = ratioOf(composite(rgb(styles.color), bg), bg);
    const need = large ? 3 : 4.5;
    if (ratio < need) {
      findings.push({ text: text.slice(0, 24), ratio: Math.round(ratio * 100) / 100, need, size });
    }
  }

  // ---- Focus indicators, WCAG 1.4.11 ----------------------------------------
  //
  // A ring is drawn *outside* the control, so the colour it has to stand out
  // from is whatever the control sits on, not the control's own fill. An inset
  // ring is the other way round, which is why the two are measured against
  // different backgrounds rather than one convenient average.
  //
  // Every component here rings on `:focus-visible`, and that pseudo-class only
  // matches when the last input was a keyboard. The caller presses Tab once
  // before this runs to put Blink in keyboard modality; without it every
  // `.focus()` below is silent and the whole pass reports a clean zero.
  const FOCUSABLE =
    'a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex="-1"])';
  let ringsSeen = 0;

  for (const el of document.querySelectorAll(FOCUSABLE)) {
    if (el.closest('.sr-only, [aria-hidden="true"]') || el.closest(INACTIVE)) continue;
    if (el.closest(FOREIGN)) continue;
    const box = el.getBoundingClientRect();
    if (box.width < 2 || box.height < 2) continue;

    // What the element looks like *before* it has focus, so the indicator can
    // be defined as the difference rather than as whatever shadow happens to be
    // on the element. An elevation shadow with a positive spread is not a focus
    // ring, and treating it as one reported sub-pixel "rings" on Storybook's
    // own chrome that no amount of squinting would find.
    const restingShadow = getComputedStyle(el).boxShadow;

    try {
      el.focus({ preventScroll: true });
    } catch {
      continue;
    }
    if (document.activeElement !== el) continue;

    const styles = getComputedStyle(el);
    const indicators = [];

    const outlineWidth = parseFloat(styles.outlineWidth);
    if (styles.outlineStyle !== 'none' && outlineWidth > 0) {
      // Judged against what is behind the control, which is where a ring with a
      // positive offset is drawn.
      indicators.push({ colour: styles.outlineColor, inset: false, width: outlineWidth });

    }

    // Computed box-shadow puts the colour first: "rgb(91, 91, 214) 0px 0px 0px 2px".
    // A ring is a shadow with no blur and a spread, which is also how it is
    // distinguished here from an ordinary elevation shadow.
    if (styles.boxShadow && styles.boxShadow !== 'none' && styles.boxShadow !== restingShadow) {
      for (const layer of styles.boxShadow.split(/,(?![^(]*\))/)) {
        const colour = layer.match(/(rgba?\([^)]+\)|#[0-9a-f]{3,8})/i);
        const lengths = layer.match(/-?\d*\.?\d+px/g);
        if (!colour || !lengths || lengths.length < 4) continue;
        const spread = parseFloat(lengths[3]);
        if (spread < 1) continue;
        indicators.push({ colour: colour[1], inset: layer.includes('inset'), width: spread });
      }
    }

    if (indicators.length === 0) continue;
    ringsSeen += 1;

    const outside = backgroundOf(el.parentElement ?? el);
    const inside = backgroundOf(el);
    // The best ring wins. A control may carry both an outline and a shadow, and
    // one visible indicator is all the criterion asks for.
    let best = 0;
    let widest = 0;
    for (const indicator of indicators) {
      const against = indicator.inset ? inside : outside;
      const ratio = ratioOf(composite(rgb(indicator.colour), against), against);
      if (ratio > best) {
        best = ratio;
        widest = indicator.width;
      }
    }

    if (best < 3) {
      const name = el.tagName.toLowerCase();
      const label = (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 14);
      // The class comes along because a ring finding with no label identifies
      // nothing: "focus ring on button" appeared six times in one run and cost
      // a diagnosis session to place.
      const hint =
        label ||
        (el.getAttribute('class') ?? '')
          .split(/\s+/)
          .filter((token) => token && !token.startsWith('css-'))
          .slice(0, 2)
          .join('.');
      findings.push({
        text: 'focus ring on ' + name + (hint ? ' "' + hint + '"' : ''),
        ratio: Math.round(best * 100) / 100,
        need: 3,
        size: Math.round(widest),
      });
    }
  }

  // ---- Chart palette, WCAG 1.4.11 -------------------------------------------
  //
  // A donut slice or a line is a graphical object required to understand the
  // content, so it owes 3:1 against what it is drawn on. The icon pass above
  // deliberately skips charts, because reading a multi-colour SVG's root gives
  // a number about no part of the picture.
  //
  // Measuring the palette rather than the rendered marks is not a shortcut
  // here: `ChartTone` is a closed union of six names, and every series colour
  // in every chart resolves to one of them. Checking the six against the
  // surfaces a chart can sit on covers every mark that can ever be drawn,
  // including the ones no story happens to render.
  if (options.palette) {
    const CHART_TONES = [
      'accent-fg',
      'success-fg',
      'warning-fg',
      'danger-fg',
      'info-fg',
      'fg-subtle',
    ];
    const CHART_SURFACES = ['surface', 'surface-sunken'];
    const root = getComputedStyle(document.documentElement);

    for (const tone of CHART_TONES) {
      const ink = root.getPropertyValue('--reach-color-' + tone).trim();
      if (!ink) continue;
      for (const surface of CHART_SURFACES) {
        const paper = root.getPropertyValue('--reach-color-' + surface).trim();
        if (!paper) continue;
        const bg = rgb(paper);
        const ratio = ratioOf(composite(rgb(ink), bg), bg);
        if (ratio < 3) {
          findings.push({
            text: 'chart series "' + tone + '" on ' + surface,
            ratio: Math.round(ratio * 100) / 100,
            need: 3,
            size: 0,
          });
        }
      }
    }
  }

  return { findings, ringsSeen };
}
/* eslint-enable unicorn/consistent-function-scoping */

/**
 * PAGE_URL points the sweep at an ordinary page instead of at Storybook.
 *
 * The documentation site is built out of the design system and makes claims
 * about these thresholds, so it is held to them too. A page has no Storybook
 * globals, so the theme is set by putting the class on `<html>` directly, which
 * is the same mechanism an application uses.
 */
const pageUrl = process.env.PAGE_URL;

/**
 * Docs entries are swept as well as stories.
 *
 * They were not, and that is how a docs page shipped with dark prose on a dark
 * canvas: `type === 'story'` skipped every MDX page in the sidebar, so the one
 * page a new reader opens first was the one page nothing measured. A docs page
 * is also where Storybook's own unlayered CSS meets the design system's
 * layered utilities, which is exactly the collision worth checking.
 *
 * STORY_FILTER narrows the run to ids containing a substring. CI never sets it;
 * it exists so that triaging one component, or proving the gate still fails on
 * a known bug, does not cost a full pass over everything.
 */
const stories = pageUrl
  ? [{ id: pageUrl, url: pageUrl, standalone: true }]
  : Object.values((await (await fetch(BASE + '/index.json')).json()).entries)
      .filter(
        (entry) =>
          (entry.type === 'story' || entry.type === 'docs') &&
          (!process.env.STORY_FILTER || entry.id.includes(process.env.STORY_FILTER)),
      )
      .map((entry) => ({ id: entry.id, viewMode: entry.type === 'docs' ? 'docs' : 'story' }));

const browser = await chromium.launch();

/**
 * Density is a property of the pointer here, not of the screen: `--reach-control-*`
 * re-points under `@media (pointer: coarse)`, so a touch build is a different
 * set of sizes and paddings and can put text on a different background. One
 * desktop pass says nothing about it.
 *
 * `hasTouch` is what makes `pointer: coarse` match. Setting a narrow viewport
 * alone changes the layout and leaves the density tokens on their fine-pointer
 * values, which would be a pass that means nothing.
 */
const PROFILES = [
  { name: 'desktop', viewport: { width: 1200, height: 900 }, hasTouch: false, isMobile: false },
  { name: 'touch', viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true },
];

const failures = [];
const skipped = [];
const palettesChecked = new Set();
let ringsSeen = 0;
let checks = 0;

for (const profile of PROFILES) {
  const context = await browser.newContext({
    viewport: profile.viewport,
    hasTouch: profile.hasTouch,
    isMobile: profile.isMobile,
  });
  const page = await context.newPage();

  for (const story of stories) {
    for (const theme of ['light', 'dark']) {
      const url = story.standalone
        ? story.url
        : BASE +
          '/iframe.html?id=' +
          story.id +
          '&viewMode=' +
          story.viewMode +
          '&globals=theme:' +
          theme;
      try {
        await page.goto(url, { waitUntil: 'networkidle', timeout: 20000 });

        if (story.standalone) {
          // An ordinary page has no Storybook global to drive, so the class
          // goes on directly. Same mechanism, one less layer.
          await page.evaluate((want) => {
            document.documentElement.classList.toggle('dark', want === 'dark');
          }, theme);
        } else {
          // Wait for the theme to actually be on the document, not for a guess
          // at how long that takes. The decorator applies the class after
          // render, and at the 120ms this used to sleep the class was usually
          // not there yet: the dark half of the sweep was measuring the light
          // theme and reporting it under the dark label. `networkidle` does not
          // cover it, because nothing is fetched.
          await page.waitForFunction(
            (want) => {
              // A docs page renders into `#storybook-docs`, a story into
              // `#storybook-root`, and both containers exist on both kinds of
              // page. Picking the first one that resolves waits forever on the
              // empty one, so take whichever actually has content.
              // Storybook shows a skeleton while a page prepares, and the
              // skeleton has content: waiting only for children measured grey
              // placeholders on grey and reported thousands of 1:1 findings
              // about markup no reader ever sees.
              //
              // Visibility, not presence. `.sb-preparing-story` and
              // `.sb-preparing-docs` are permanent wrappers that stay in the
              // DOM at `display: none` once the page has rendered, so testing
              // for the element timed out every render in the suite and the run
              // reported 1864 unmeasured.
              const skeletons = document.querySelectorAll(
                '.sb-preparing-docs, .sb-preparing-story',
              );
              for (const skeleton of skeletons) {
                if (skeleton.getBoundingClientRect().height > 0) return false;
              }
              const roots = ['#storybook-root', '#storybook-docs']
                .map((selector) => document.querySelector(selector))
                .filter((node) => node !== null);
              if (!roots.some((node) => node.childElementCount > 0)) return false;
              // Light is the absence of the class, so this half of the
              // condition is already true on a blank page. The rendered-children
              // check above is what stops it passing before the story exists.
              return document.documentElement.classList.contains('dark') === (want === 'dark');
            },
            theme,
            { timeout: 10000 },
          );
        }
        // Puts Blink into keyboard modality so `:focus-visible` matches the
        // programmatic focus the measurement uses. See the note in `measure`.
        await page.keyboard.press('Tab');
        // The palette check reads tokens off `:root`, so it is the same answer in
        // every story. Run it once per theme rather than 372 times.
        const palette = !palettesChecked.has(theme);
        palettesChecked.add(theme);
        /*
         * Freeze transitions before measuring.
         *
         * `measure` focuses each control and reads its computed style in the
         * same tick. Reach animates `outline-color` through `transition-colors`,
         * so that read lands mid-transition and reports a colour the ring is
         * only passing through, not the one it settles on. On a selected
         * calendar day the resting colour is the white label, and against the
         * white page behind the button that measured 1:1: an invisible ring
         * that is plainly visible on screen.
         *
         * It stayed hidden until the `duration-[--var]` classes were corrected.
         * Those compiled to an invalid `transition-duration` and therefore to
         * `0s`, so every transition finished instantly and the read happened to
         * catch the final value. Repairing them made the gate honest and this
         * assumption visible.
         *
         * Injected per render because a story remounts its own DOM, and cheap
         * enough that it is not worth tracking whether it is already there.
         */
        await page.addStyleTag({
          content:
            '*, *::before, *::after { transition: none !important; animation: none !important; }',
        });

        const result = await page.evaluate(measure, { palette });
        ringsSeen += result.ringsSeen;
        checks += 1;
        for (const found of result.findings) {
          failures.push({ story: story.id, theme, profile: profile.name, ...found });
        }
      } catch (error) {
        // Counted, not swallowed. A story that fails to settle is measured by
        // nothing, and a run that quietly skipped half the suite prints the
        // same clean zero as a run that checked all of it.
        skipped.push({
          story: story.id,
          theme,
          profile: profile.name,
          reason: String(error).split('\n')[0].slice(0, 90),
        });
      }
    }
  }
  await context.close();
}
await browser.close();

const grouped = new Map();
for (const failure of failures) {
  const key = failure.story + ' [' + failure.theme + ', ' + failure.profile + ']';
  if (!grouped.has(key)) grouped.set(key, []);
  grouped.get(key).push(failure);
}

console.log(
  'stories checked: ' +
    stories.length +
    ' x 2 themes x ' +
    PROFILES.length +
    ' pointer profiles = ' +
    checks +
    ' renders',
);
console.log('focus rings measured: ' + ringsSeen);
console.log('below threshold: ' + failures.length + ' across ' + grouped.size + ' combinations\n');

if (skipped.length > 0) {
  console.error('unmeasured: ' + skipped.length + ' renders never settled\n');
  for (const item of skipped.slice(0, 20)) {
    console.error(
      '   ' + item.story + ' [' + item.theme + ', ' + item.profile + ']  ' + item.reason,
    );
  }
  if (skipped.length > 20) console.error('   ... and ' + (skipped.length - 20) + ' more');
}

for (const [key, items] of grouped) {
  console.log(key);
  for (const item of items) {
    console.log(
      '   ' + item.ratio + ':1 (needs ' + item.need + ')  ' + item.size + 'px  "' + item.text + '"',
    );
  }
}

// A focus pass that measures nothing reports the same clean zero as a focus
// pass that measures everything. If `:focus-visible` stops matching, that is a
// broken gate rather than a passing one, and it should say so.
// Docs pages have no controls to focus, so a run narrowed to one of them can
// legitimately measure no rings. Only a run that rendered a story owes any.
const sweptAStory = stories.some((entry) => entry.standalone || entry.viewMode === 'story');
const blind = ringsSeen === 0 && sweptAStory;
if (blind) {
  console.error(
    '\nNo focus ring was measured in any story. Either nothing is focusable or\n' +
      ':focus-visible stopped matching programmatic focus. Treating as a failure.',
  );
}

// A gate, not a report. Anything unmeasured counts against it: the point of
// this file is that a green result means something was checked.
process.exit(failures.length === 0 && skipped.length === 0 && !blind ? 0 : 1);
