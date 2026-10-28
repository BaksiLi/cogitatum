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
    await page.close();
  }
  assert.deepEqual(errors, []);
  console.log('Map motion browser checks passed: 2 viewports; dragging, insertion, low-frame expiry, suspension, entrance inspection, reduced motion, cleanup and idle scheduling.');
} finally {
  await browser.close();
}
