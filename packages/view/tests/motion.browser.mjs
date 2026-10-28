import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// Supply Playwright from the paired development repository through NODE_PATH.
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const { build } = require('esbuild');
const bundle = await build({
  stdin: {
    contents: `
      import { compileSource } from '../../core/src/index.ts';
      import { createGraphView } from './index.ts';
      window.mount = (source, options = {}) => {
        window.view?.destroy();
        window.view = createGraphView(document.querySelector('#map'), {
          ...options, reducedMotion: () => !!window.hostReduced
        });
        window.update = source => window.view.update(compileSource(source, 'document').graphs[0], 'test');
        window.update(source);
      };
    `,
    resolveDir: fileURLToPath(new URL('../src/', import.meta.url)),
  },
  bundle: true, write: false, format: 'iife', platform: 'browser',
});
const browser = await chromium.launch();
const errors = [];
try {
  for (const width of [1280, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'no-preference' });
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent('<div id="map" style="height:600px"></div>');
    await page.addStyleTag({ path: fileURLToPath(new URL('../src/style.css', import.meta.url)) });
    // Control frame delivery independently of real pointer events, including slow and suspended frames.
    await page.evaluate(() => {
      let time = 0, id = 0;
      const frames = new Map();
      performance.now = () => time;
      window.requestAnimationFrame = callback => { frames.set(++id, callback); return id; };
      window.cancelAnimationFrame = id => frames.delete(id);
      window.ResizeObserver = class { observe() {} disconnect() {} };
      window.IntersectionObserver = class {
        constructor(callback) { this.callback = callback; }
        observe() { window.intersect = () => this.callback([{ isIntersecting: true }]); }
        disconnect() { window.intersect = () => {}; }
      };
      window.advance = elapsed => {
        time += elapsed;
        const work = [...frames.values()]; frames.clear();
        for (const callback of work) callback(time);
        return frames.size;
      };
      window.pendingFrames = () => frames.size;
    });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const advance = elapsed => page.evaluate(elapsed => window.advance(elapsed), elapsed);
    const point = key => page.locator(`#map [data-node="point:${key}"]`);
    const positions = () => page.locator('#map .cog-node').evaluateAll(nodes =>
      Object.fromEntries(nodes.map(node => [node.dataset.node, node.getAttribute('transform')])));
    const drag = async key => {
      const at = await point(key).evaluate(node => {
        const matrix = node.transform.baseVal.consolidate().matrix;
        const box = node.ownerSVGElement.getBoundingClientRect();
        return { x: box.x + matrix.e, y: box.y + matrix.f };
      });
      await page.mouse.move(at.x, at.y); await page.mouse.down();
      await page.mouse.move(at.x - 30, at.y);
      assert.equal(await page.locator('#map svg').getAttribute('data-dragging'), 'node');
      await page.mouse.up();
    };

    await page.evaluate(() => window.mount('- [C @a] A.\n- [C @b] B.\n'));
    const unrelated = await point('_p2').getAttribute('transform');
    await drag('_p1'); await advance(1000 / 60);
    assert.equal(await point('_p2').getAttribute('transform'), unrelated, 'a disconnected node stays fixed during dragging');
    await page.evaluate(() => window.update('- [C @a] A.\n- [C] Inserted.\n- [C @b] B.\n'));
    for (let frame = 0; frame < 30; frame++) await advance(1000 / 60);
    const insertedAt = await point('_p2').getAttribute('transform');
    const unrelatedAt = await point('_p3').getAttribute('transform');
    assert.notEqual(unrelatedAt, insertedAt, 'an untouched named node follows the revised layout rather than overlapping the inserted node');
    assert.equal(await page.evaluate(() => window.pendingFrames()), 0);

    const joint = "- [C @claim] Claim.\n  - [_ G]\n    - [. @first] First.\n    - [. @second] Second.\n- [C @separate] Separate.\n";
    await page.evaluate(source => window.mount(source), joint);
    const claimAt = await point('_p1').getAttribute('transform'), secondAt = await point('_p3').getAttribute('transform');
    await drag('_p2');
    for (let frame = 0; frame < 30; frame++) await advance(1000 / 60);
    assert.equal(await point('_p1').getAttribute('transform'), claimAt, 'a plain drag leaves the target Point in place');
    assert.equal(await point('_p3').getAttribute('transform'), secondAt, 'a plain drag leaves the co-source in place');
    await page.keyboard.down('Shift'); await drag('_p2'); await page.keyboard.up('Shift');
    for (let frame = 0; frame < 30; frame++) await advance(1000 / 60);
    assert.notEqual(await point('_p1').getAttribute('transform'), claimAt, 'Shift-drag pulls the step\'s target');

    await page.evaluate(source => window.mount(source), joint);
    await drag('_p2');
    for (let frame = 0; frame < 9; frame++) await advance(100);
    assert.equal(await page.evaluate(() => window.pendingFrames()), 0, '10 Hz frame delivery stops scheduling at the wall-time deadline');
    const settled = await positions(); await advance(1000);
    assert.deepEqual(await positions(), settled);

    await page.evaluate(source => window.mount(source), joint);
    await drag('_p2');
    await advance(0); // Paint the direct pointer placement without advancing physics.
    const suspended = await positions();
    assert.equal(await advance(1000), 0, 'a suspended frame expires without another scheduled frame');
    assert.deepEqual(await positions(), suspended, 'resuming after the deadline does not apply stale physics');

    // Entrance is optional decoration: inspecting a route must immediately restore normal guidance.
    await page.addStyleTag({ content: '.cog-graph * { transition: none !important; }' });
    await page.mouse.move(0, 0);
    await page.evaluate(source => window.mount(source, { entrance: true }), joint);
    assert.equal(await point('_p1').evaluate(node => node.style.opacity), '0');
    await page.evaluate(() => window.view.select({ kind: 'bearing', key: '_b1' }));
    assert.equal(await point('_p1').evaluate(node => node.style.opacity), '', 'programmatic selection reveals a not-yet-intersecting map');
    assert.equal(await point('_p4').evaluate(node => getComputedStyle(node).opacity), '0.28', 'unrelated points dim immediately');
    await advance(1000);
    assert.equal(await page.evaluate(() => window.pendingFrames()), 0);

    await page.evaluate(source => { window.mount(source, { entrance: true }); window.intersect(); }, joint);
    await advance(250);
    const appearing = Number(await point('_p1').evaluate(node => node.style.opacity));
    assert.ok(appearing > 0 && appearing < 1, 'uninterrupted entrance actually animates');
    await point('_p1').focus();
    assert.equal(await point('_p1').evaluate(node => node.style.opacity), '', 'keyboard focus completes entrance before revealing the mark');
    assert.equal(await page.locator('#map path[pathLength]').count(), 0, 'inspection shows complete routes');

    await page.evaluate(source => { window.mount(source, { entrance: true }); window.intersect(); }, joint);
    await advance(250);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await advance(0);
    assert.equal(await point('_p1').evaluate(node => node.style.opacity), '', 'reduced motion ends an active entrance');
    assert.equal(await page.evaluate(() => window.pendingFrames()), 0, 'reduced motion leaves no entrance frames');
    await page.evaluate(source => window.mount(source, { entrance: true }), joint);
    assert.equal(await point('_p1').evaluate(node => node.style.opacity), '', 'reduced motion also bypasses a pending entrance');
    await page.emulateMedia({ reducedMotion: 'no-preference' });

    await page.evaluate(source => { window.mount(source, { entrance: true }); window.intersect(); }, joint);
    await advance(250);
    await page.evaluate(() => { window.hostReduced = true; });
    await advance(0);
    assert.equal(await point('_p1').evaluate(node => node.style.opacity), '', 'a host motion preference is respected on the next frame');
    await page.evaluate(() => { window.hostReduced = false; });

    await page.evaluate(source => { window.mount(source, { entrance: true }); window.intersect(); }, joint);
    await advance(5000); await advance(0);
    assert.equal(await point('_p1').evaluate(node => node.style.opacity), '', 'completed entrance releases inline opacity');
    assert.equal(await page.evaluate(() => window.pendingFrames()), 0, 'completed entrance becomes idle');
    await page.evaluate(source => { window.mount(source, { entrance: true }); window.intersect(); }, joint);
    await page.evaluate(() => window.view.destroy());
    assert.equal(await page.evaluate(() => window.pendingFrames()), 0, 'destroy cancels active entrance');

    // A continuous zoom keeps wording and curves under the fingers, then reflows once when it rests.
    const worded = '- [C @claim] A conclusion whose `wording()` runs long enough to wrap across lines.\n  - [G @why] A reason with `code()` that also runs on for a while, so its line breaks follow the measure.\n';
    await page.evaluate(source => window.mount(source), worded);
    await advance(0);
    const wording = () => page.locator('#map .cog-node .cog-text').evaluateAll(nodes => nodes.map(node => [...node.childNodes].map(line => line.textContent).join('|')));
    const routes = () => page.locator('#map .cog-link').evaluateAll(paths => paths.map(path => path.getAttribute('d')));
    const before = await wording();
    const beforeScroll = await routes();
    assert.equal(await page.evaluate(() => document.querySelector('#map svg').dispatchEvent(new WheelEvent('wheel', { deltaY: 80, bubbles: true, cancelable: true }))), true,
      'an ordinary wheel remains available to the host page');
    await advance(0);
    assert.deepEqual(await routes(), beforeScroll, 'an ordinary wheel does not zoom the Map');
    await page.locator('#map .cog-node .cog-text').first().evaluate(label => { window.heldLabel = label.firstChild; });
    for (let step = 0; step < 12; step++) {
      await page.evaluate(() => document.querySelector('#map svg').dispatchEvent(new WheelEvent('wheel', { deltaY: 10, ctrlKey: true, clientX: 160, clientY: 160, bubbles: true, cancelable: true })));
      await advance(1000 / 60);
    }
    assert.deepEqual(await wording(), before, 'wording keeps its line breaks while a zoom is in motion');
    assert.equal(await page.locator('#map .cog-node .cog-text').first().evaluate(label => label.firstChild === window.heldLabel), true,
      'zooming retains the text nodes and their measured hit areas');
    const clearance = await page.locator('#map svg').evaluate(svg => {
      const label = svg.querySelector('[data-node="point:_p1"] .cog-text').getBoundingClientRect();
      const path = svg.querySelector('.cog-link.output');
      return path.getPointAtLength(path.getTotalLength()).y + svg.getBoundingClientRect().top - label.bottom;
    });
    assert.ok(clearance > 0, `the link stops outside the held wording (${clearance})`);
    await page.waitForTimeout(260); await advance(1000 / 60);
    assert.notDeepEqual(await wording(), before, 'wording reflows for the new scale once the zoom rests');

    // Two fingers spread on the glass zoom the Map.
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
    await page.evaluate(source => window.mount(source), worded);
    await advance(0);
    const box = await page.locator('#map svg').boundingBox();
    const cx = box.x + box.width / 2, cy = box.y + 200;
    const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y], id) => ({ x, y, id })) });
    const start = await routes();
    await touch('touchStart', [[cx - 40, cy]]);
    await touch('touchStart', [[cx - 40, cy], [cx + 40, cy]]);
    for (let spread = 1; spread <= 5; spread++) { await touch('touchMove', [[cx - 40 - spread * 10, cy], [cx + 40 + spread * 10, cy]]); await advance(1000 / 60); }
    assert.notDeepEqual(await routes(), start, 'spreading two fingers zooms the Map');
    await touch('touchEnd', []); await page.waitForTimeout(260); await advance(1000 / 60);

    // Explicit capture bookkeeping lets interruptions and either release order be checked independently of CDP.
    const mountPointers = async (source = worded) => {
      await page.evaluate(source => {
        window.hostReduced = true;
        window.mount(source);
        window.captured = new Set();
        const svg = document.querySelector('#map svg');
        svg.setPointerCapture = id => window.captured.add(id);
        svg.hasPointerCapture = id => window.captured.has(id);
        svg.releasePointerCapture = id => {
          window.captured.delete(id);
          svg.dispatchEvent(new PointerEvent('lostpointercapture', { pointerId: id }));
        };
      }, source);
      await advance(0);
    };
    const pointer = (type, pointerId, x, selector = '#map svg') => page.evaluate(([type, pointerId, x, y, selector]) => document.querySelector(selector).dispatchEvent(
      new PointerEvent(type, { pointerId, pointerType: 'touch', isPrimary: pointerId === 1, clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true })), [type, pointerId, x, cy, selector]);
    const beginPinch = async () => {
      await pointer('pointerdown', 1, cx - 40); await pointer('pointerdown', 2, cx + 40);
      for (let spread = 1; spread <= 5; spread++) {
        await pointer('pointermove', 1, cx - 40 - spread * 10); await pointer('pointermove', 2, cx + 40 + spread * 10);
        await advance(1000 / 60);
      }
    };
    for (const lifted of [2, 1]) {
      await mountPointers(); await beginPinch();
      const pinched = await routes();
      const remaining = lifted === 1 ? 2 : 1, at = cx + (remaining === 1 ? -90 : 90);
      await pointer('pointerup', lifted, cx + (lifted === 1 ? -90 : 90)); await advance(1000 / 60);
      assert.deepEqual(await routes(), pinched, `lifting finger ${lifted} leaves the camera in place`);
      await pointer('pointermove', remaining, at + 5); await advance(1000 / 60);
      const shift = (await routes()).map((d, i) => Number(d.match(/^M([\d.-]+)/)[1]) - Number(pinched[i].match(/^M([\d.-]+)/)[1]));
      assert.ok(shift.length && shift.every(dx => Math.abs(dx - 5) < .2), `finger ${remaining} pans from the pinched view (${shift})`);
      await pointer('pointerup', remaining, at + 5);
      assert.equal(await page.locator('#map [aria-pressed="true"]').count(), 0, 'a pinch never becomes a Point selection');
      assert.equal(await page.evaluate(() => window.captured.size), 0, 'the completed pinch releases every capture');
    }

    await mountPointers(); await beginPinch();
    assert.deepEqual(await page.evaluate(() => [...window.captured]), [1, 2], 'both fingers remain captured outside the canvas');
    const paused = await wording();
    await page.waitForTimeout(260); await advance(0);
    assert.deepEqual(await wording(), paused, 'resting fingers keep the same wording until the pinch ends');
    const beforeThird = await routes();
    await pointer('pointerdown', 3, cx); await pointer('pointermove', 3, cx + 60); await advance(0);
    assert.deepEqual(await routes(), beforeThird, 'an extra finger does not replace the active pinch');
    await pointer('pointerup', 3, cx + 60);
    await pointer('pointermove', 1, cx - 85); await pointer('pointermove', 2, cx + 95); await advance(0);
    assert.notDeepEqual(await routes(), beforeThird, 'the original pair keeps control when translated');
    await pointer('pointerup', 1, cx - 85); await pointer('pointerup', 2, cx + 95);

    for (const interruption of ['pointercancel', 'lostpointercapture']) {
      await mountPointers(); await beginPinch();
      await pointer(interruption, 2, cx + 90); await advance(0);
      const cancelled = await routes();
      await pointer('pointermove', 1, cx - 60); await pointer('pointerup', 1, cx - 60); await advance(0);
      assert.deepEqual(await routes(), cancelled, `${interruption} retires the whole gesture`);
      assert.equal(await page.locator('#map svg').getAttribute('data-dragging'), null);
      assert.equal(await page.evaluate(() => window.captured.size), 0);
      // A suppressed synthetic pointer click must not swallow an assistive activation.
      await point('_p1').dispatchEvent('click', { detail: 0 });
      assert.equal(await point('_p1').getAttribute('aria-pressed'), 'true');
    }

    await mountPointers();
    const fresh = await wording();
    const tall = Array.from({ length: 14 }, (_, i) => `${'  '.repeat(i)}- [${i ? 'G' : 'C'} @old${i}] Old material ${i}.`).join('\n');
    await page.evaluate(source => { window.update(source); window.view.fit(); }, tall); await advance(0);
    await page.evaluate(() => document.querySelector('#map svg').dispatchEvent(new WheelEvent('wheel', { deltaY: -5, ctrlKey: true, bubbles: true, cancelable: true })));
    await page.evaluate(source => window.update(source), worded); await advance(0);
    assert.deepEqual(await wording(), fresh, 'a new source revision immediately uses its own fitted wording');

    for (const action of ['fit', 'resetLayout']) {
      await mountPointers(); await beginPinch();
      await page.evaluate(action => window.view[action](), action); await advance(0);
      const reset = await routes();
      await pointer('pointermove', 1, cx - 70); await pointer('pointermove', 2, cx + 70); await advance(0);
      assert.deepEqual(await routes(), reset, `${action} cannot be overwritten by an old gesture`);
      assert.equal(await page.locator('#map svg').getAttribute('data-dragging'), null);
      assert.equal(await page.evaluate(() => window.captured.size), 0);
    }
    await mountPointers(); await beginPinch();
    await page.evaluate(() => window.view.destroy());
    assert.equal(await page.evaluate(() => window.captured.size), 0, 'destroy releases both contacts');
    await page.waitForTimeout(220);
    assert.equal(await advance(0), 0, 'destroy leaves no delayed zoom repaint');
    await page.close();
  }
  assert.deepEqual(errors, []);
  console.log('Map motion browser checks passed: 2 viewports; plain and Shift dragging, insertion, low-frame expiry, suspension, entrance inspection, reduced motion, cleanup, idle scheduling, stable zoom wording, both pinch hand-offs, capture loss, extra contacts and revision/reset boundaries.');
} finally {
  await browser.close();
}
