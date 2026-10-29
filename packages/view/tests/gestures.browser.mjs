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
      window.navigated = [];
      window.mount = source => {
        window.view?.destroy();
        window.view = createGraphView(document.querySelector('#map'), { onNavigate: node => window.navigated.push(node.id) });
        window.view.update(compileSource(source, 'document').graphs[0], 'test');
      };
    `,
    resolveDir: fileURLToPath(new URL('../src/', import.meta.url)),
  },
  bundle: true, write: false, format: 'iife', platform: 'browser',
});
const dense = [
  '- [C] Connection pool exhaustion caused the timeouts.',
  '  - [G @g; @step] Between 02:00 and 03:00 the service logged repeated connection-acquisition failures.',
  '- [Q @q] What should change before the next release?',
  '  - [C answers @q] Doubling the pool size will prevent these timeouts.',
  '    - [G use @g] The logs show the pool is too small.',
  '      - [O] The log export may use UTC, so those failures may not fall between 02:00 and 03:00 local time.',
  '      - [O/] Running out of connections does not show that a larger pool is enough; a leak would exhaust any size.',
  '- [_ use @step] The step needs scrutiny.',
  '  - [O/] Slow upstream calls would also hold connections open and produce these failures.',
].join('\n');
const siblings = '- [C @c] Claim.\n  - [G @a] First ground.\n  - [G @b] Second ground.';
const browser = await chromium.launch();
const errors = [];
let runs = 0;
try {
  for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: true, reducedMotion: 'reduce' });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent('<div id="map" style="height:640px"></div>');
    await page.addStyleTag({ path: fileURLToPath(new URL('../src/style.css', import.meta.url)) });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const flush = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const centre = async locator => { const box = await locator.boundingBox(); return { x: box.x + box.width / 2, y: box.y + box.height / 2 }; };
    const mark = name => page.locator(`#map g.cog-node.point`).filter({ has: page.locator(`title`, { hasText: `@${name}` }) }).first();

    // Wording never overlaps other wording, at any measure the pane gives it.
    await page.evaluate(source => window.mount(source), dense); await flush();
    const assertNoOverlap = async scale => {
      const boxes = await page.locator('#map .cog-text').evaluateAll(nodes => nodes.filter(node => node.childNodes.length).map(node => {
        const r = node.getBoundingClientRect(); return { x0: r.left, x1: r.right, y0: r.top, y1: r.bottom, text: node.textContent };
      }));
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        const overlap = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 1 && Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > 1;
        assert.ok(!overlap, `wording overlaps at ${width}px, ${scale}: "${a.text}" / "${b.text}"`);
      }
    };
    await assertNoOverlap('reading scale');
    // The overview keeps conclusions' wording on one line; beside each other they end early instead.
    await page.evaluate(() => window.view.zoom(.35)); await flush();
    await assertNoOverlap('overview');

    // A dragged mark snaps into its neighbour's row and shows a guide; Alt places it freely.
    await page.evaluate(source => window.mount(source), siblings); await flush();
    const a = mark('a'), b = mark('b');
    const target = await centre(b);
    for (const free of [false, true]) {
      const start = await centre(a);
      await page.mouse.move(start.x, start.y); await page.mouse.down();
      if (free) await page.keyboard.down('Alt');
      await page.mouse.move(start.x + 10, target.y + 4, { steps: 4 });
      await flush();
      assert.equal(await page.locator('#map .cog-guide').count() > 0, !free, free ? 'Alt shows no guide' : 'snapping shows a guide');
      await page.mouse.up();
      if (free) await page.keyboard.up('Alt');
      await flush();
      const [ya, yb] = [(await centre(a)).y, (await centre(b)).y];
      if (free) assert.ok(Math.abs(ya - yb) > 2, 'Alt places freely');
      else assert.ok(Math.abs(ya - yb) < .5, `the dragged mark snaps into its neighbour's row (${ya} vs ${yb})`);
      assert.equal(await page.locator('#map .cog-guide').count(), 0, 'guides leave with the drag');
    }

    // Touch: a long press opens the source; a double tap on the canvas zooms in.
    const cdp = await context.newCDPSession(page);
    const touch = (type, p) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: p.x, y: p.y }] });
    await page.evaluate(source => window.mount(source), siblings); await flush();
    const held = await centre(mark('c'));
    await touch('touchStart', held); await page.waitForTimeout(700); await touch('touchEnd', held); await flush();
    assert.equal((await page.evaluate(() => window.navigated)).length, 1, 'a long press opens the source once');
    assert.equal(await mark('c').getAttribute('aria-pressed'), 'true', 'a long press also selects the mark');
    const spread = async () => (await centre(mark('b'))).x - (await centre(mark('a'))).x;
    const before = await spread(), box = await page.locator('#map svg').boundingBox();
    const empty = { x: box.x + 12, y: box.y + box.height - 12 };
    for (let i = 0; i < 2; i++) { await touch('touchStart', empty); await touch('touchEnd', empty); await page.waitForTimeout(60); }
    await flush();
    assert.ok(await spread() > before * 1.2, 'a double tap on the canvas zooms in');
    assert.equal((await page.evaluate(() => window.navigated)).length, 1, 'tapping the canvas opens nothing');
    await context.close(); runs++;
  }
  assert.deepEqual(errors, []);
  console.log(`Map gesture browser checks passed: ${runs} viewports; wording without overlap, snapping guides and Alt, long press and double tap.`);
} finally {
  await browser.close();
}
