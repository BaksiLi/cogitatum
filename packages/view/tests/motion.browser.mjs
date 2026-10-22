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
      window.mount = source => {
        window.view?.destroy();
        window.view = createGraphView(document.querySelector('#map'));
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

    const joint = '- [C @claim] Claim.\n  - [linked]\n    - [G @first] First.\n    - [G @second] Second.\n- [C @separate] Separate.\n';
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
    await page.evaluate(() => window.view.destroy());
    await page.close();
  }
  assert.deepEqual(errors, []);
  console.log('Map motion browser checks passed: 2 viewports; real pointer dragging, disconnected source insertion, low-frame expiry, suspension and idle scheduling.');
} finally {
  await browser.close();
}
