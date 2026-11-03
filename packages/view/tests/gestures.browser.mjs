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
      window.contextMenus = [];
      window.mount = (source, contextMenu = false) => {
        window.view?.destroy();
        const options = { onNavigate: node => window.navigated.push(node.id) };
        if (contextMenu) options.onContextMenu = (node, at) => window.contextMenus.push({ id: node.id, ...at });
        window.view = createGraphView(document.querySelector('#map'), options);
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
const library = [
  '- [C] The library should stay open until eight on weekdays.',
  "  - [G] Forty people visited after six at last month's evening event.",
  '    - [O] The count included repeat entries, so fewer than forty people may have visited.',
  '    - [O/] People may have come for the special event, not for ordinary evening opening.',
].join('\n');
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
    const centre = locator => locator.evaluate(node => {
      const matrix = node.getScreenCTM(); return { x: matrix.e, y: matrix.f };
    });
    const mark = name => page.locator(`#map g.cog-node.point`).filter({ has: page.locator(`title`, { hasText: `@${name}` }) }).first();
    const paper = () => page.locator('#map svg').evaluate(svg => {
      const step = parseFloat(svg.style.backgroundSize), [x, y] = svg.style.backgroundPosition.split(' ').map(parseFloat);
      return [...svg.querySelectorAll('.cog-node:not(.cog-inline-bearing)')].map(node => {
        const p = node.transform.baseVal.consolidate().matrix;
        return { id: node.dataset.node, x: (p.e - x - step / 2) / step, y: (p.f - y - step / 2) / step };
      });
    });

    // Explicit Fit includes wording and host controls; pressing a low mark does not move the camera.
    await page.evaluate(source => { window.mount(source); window.view.setBottomInset(84); window.view.fit(); }, library);
    await flush();
    const outside = await page.locator('#map .cog-node').evaluateAll(nodes => {
      const viewport = nodes[0].ownerSVGElement.getBoundingClientRect();
      return nodes.some(node => {
        const box = node.getBoundingClientRect();
        return box.top < viewport.top || box.bottom > viewport.bottom - 84 || box.left < viewport.left || box.right > viewport.right;
      });
    });
    assert.equal(outside, false, 'Fit keeps complete marks and wording above the host controls');
    const low = page.locator('.cog-node.point[aria-label^="Objection: The count"]');
    const pressed = await centre(low), claim = page.locator('.cog-node.point').first(), claimBefore = await centre(claim);
    await page.mouse.move(pressed.x, pressed.y); await page.mouse.down(); await flush();
    assert.deepEqual(await centre(claim), claimBefore, 'pointer focus does not pan a fitted drawing');
    const ground = page.locator('.cog-node.point[aria-label^="Ground:"]'), groundAt = await centre(ground);
    const plate = await ground.locator('.cog-label-hit').boundingBox();
    await page.mouse.move(plate.x > 64 ? plate.x - 48 : plate.x + plate.width + 48, groundAt.y + 54, { steps: 6 });
    await page.mouse.up(); await flush();
    const hiddenRoute = await ground.evaluate(node => {
      const box = node.querySelector('.cog-label-hit').getBoundingClientRect(), svg = node.ownerSVGElement, viewport = svg.getBoundingClientRect();
      const path = svg.querySelector('.cog-link.output[data-bearing="_b2"]');
      let hits = 0;
      for (const ink of [path, path.nextElementSibling]) for (let i = 1; i < 32; i++) {
        const p = ink.getPointAtLength(ink.getTotalLength() * i / 32);
        if (p.x + viewport.x > box.left && p.x + viewport.x < box.right && p.y + viewport.y > box.top && p.y + viewport.y < box.bottom) hits++;
      }
      return hits;
    });
    assert.equal(hiddenRoute, 0, 'a side challenge and its arrow stay outside the target wording plate');

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

    for (const text of ['A long sentence about repeated acquisition failures. '.repeat(20), '連線耗盡應該仔細分析原因'.repeat(30), '`' + 'wide_identifier_'.repeat(35) + '`']) {
      await page.evaluate(source => window.mount(source), `- [C] ${text}\n  - [G] ${text}\n  - [G] ${text}`); await flush();
      await assertNoOverlap('extreme labels');
      const tooWide = await page.locator('#map .cog-text').evaluateAll(nodes => nodes.some(node => node.getBoundingClientRect().width > node.ownerSVGElement.getBoundingClientRect().width));
      assert.equal(tooWide, false, 'extreme wording stays narrower than its viewport');
      await page.evaluate(() => window.view.zoom(.5)); await flush();
      await assertNoOverlap('extreme labels, overview');
    }

    // A dragged mark snaps into its neighbour's row and shows a guide; Alt places it freely.
    await page.evaluate(source => window.mount(source), siblings); await flush();
    for (const p of await paper()) for (const axis of ['x', 'y']) assert.ok(Math.abs(p[axis] - Math.round(p[axis])) < .025, 'Arrange uses paper intersections');
    const arranged = await paper();
    await page.mouse.move(10, 10); await page.mouse.down(); await page.mouse.move(41, 29); await page.mouse.up(); await flush();
    await page.evaluate(() => window.view.zoom(.8)); await flush();
    const movedPaper = await paper();
    for (let i = 0; i < arranged.length; i++) for (const axis of ['x', 'y']) assert.ok(Math.abs(arranged[i][axis] - movedPaper[i][axis]) < .025, 'paper and marks pan and zoom together');
    await mark('a').focus(); await flush();
    const keyboardBefore = (await paper()).find(p => p.id === 'point:_p2');
    await page.keyboard.press('Alt+ArrowRight'); await flush();
    const keyboardAfter = (await paper()).find(p => p.id === keyboardBefore.id);
    assert.ok(Math.abs(keyboardAfter.x - keyboardBefore.x - 1) < .025, 'keyboard placement advances one paper interval');
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
    const touch = (type, p) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: ['touchEnd', 'touchCancel'].includes(type) ? [] : [{ x: p.x, y: p.y }] });
    await page.evaluate(source => window.mount(source), siblings); await flush();
    const held = await centre(mark('c'));
    await touch('touchStart', held); await page.waitForTimeout(700); await touch('touchEnd', held); await flush();
    assert.equal((await page.evaluate(() => window.navigated)).length, 1, 'a long press opens the source once');
    assert.equal(await mark('c').getAttribute('aria-pressed'), 'true', 'a long press also selects the mark');
    await touch('touchStart', held); await page.waitForTimeout(600);
    await touch('touchMove', { x: held.x + 45, y: held.y + 30 }); await flush();
    assert.deepEqual(await centre(mark('c')), held, 'moving after a consumed long press does not drag the mark');
    await touch('touchEnd', held); await flush();
    assert.equal((await page.evaluate(() => window.navigated)).length, 2, 'the next long press opens once');
    for (let i = 0; i < 2; i++) { await touch('touchStart', held); await touch('touchEnd', held); await page.waitForTimeout(60); }
    await flush();
    assert.equal((await page.evaluate(() => window.navigated)).length, 3, 'a double tap on a mark opens its source exactly once');
    const spread = async () => (await centre(mark('b'))).x - (await centre(mark('a'))).x;
    const before = await spread(), box = await page.locator('#map svg').boundingBox();
    const empty = { x: box.x + 12, y: box.y + box.height - 12 };
    for (let i = 0; i < 2; i++) { await touch('touchStart', empty); await touch('touchEnd', empty); await page.waitForTimeout(60); }
    await flush();
    const after = await spread();
    assert.ok(after > before * 1.2, `a double tap on the canvas zooms in (${before} -> ${after})`);
    assert.equal((await page.evaluate(() => window.navigated)).length, 3, 'tapping the canvas opens nothing');
    await page.evaluate(source => window.mount(source), siblings); await flush();
    const cancelled = await centre(mark('c'));
    await touch('touchStart', cancelled); await touch('touchCancel', cancelled);
    await page.waitForTimeout(600); await flush();
    assert.equal((await page.evaluate(() => window.navigated)).length, 3, 'cancelling a hold retires its navigation timer');
    assert.equal(await page.locator('#map svg').getAttribute('data-dragging'), null);
    await touch('touchStart', cancelled); await touch('touchEnd', cancelled); await flush();
    assert.equal((await page.evaluate(() => window.navigated)).length, 3, 'a fresh tap after cancellation selects without navigating');
    await mark('c').dblclick(); await flush();
    assert.equal((await page.evaluate(() => window.navigated)).length, 4, 'a captured mouse double click opens once');

    // Hosts with context actions receive the mark and client coordinates without source navigation.
    await page.evaluate(source => window.mount(source, true), siblings); await flush();
    const assertContext = async (locator, at, count) => {
      const menus = await page.evaluate(() => window.contextMenus);
      assert.equal(menus.length, count, 'each context gesture calls the host exactly once');
      const menu = menus.at(-1);
      assert.equal(menu.id, await locator.getAttribute('data-node'), 'the context callback receives the requested mark');
      assert.ok(Math.abs(menu.clientX - at.x) < 1 && Math.abs(menu.clientY - at.y) < 1,
        `context coordinates match the gesture: ${JSON.stringify(menu)} vs ${JSON.stringify(at)}`);
      assert.equal(await locator.getAttribute('aria-pressed'), 'true', 'context actions select their mark');
      assert.equal((await page.evaluate(() => window.navigated)).length, 4, 'context actions do not also navigate');
    };
    const clicked = await centre(mark('c'));
    const menuAt = { x: Math.round(clicked.x), y: Math.round(clicked.y) };
    await page.mouse.click(menuAt.x, menuAt.y, { button: 'right' }); await flush();
    await assertContext(mark('c'), menuAt, 1);

    const bearing = page.locator('#map g.cog-node[data-node^="bearing:"]').first();
    for (const [i, key] of ['Shift+F10', 'ContextMenu'].entries()) {
      const focused = i ? bearing : mark('a');
      await focused.focus(); await flush();
      const bounds = await focused.boundingBox();
      await page.keyboard.press(key); await flush();
      await assertContext(focused, { x: bounds.x, y: bounds.y + bounds.height }, i + 2);
    }

    await page.evaluate(() => window.view.clear()); await flush();
    const contextHeld = await centre(mark('c'));
    await touch('touchStart', contextHeld); await page.waitForTimeout(700); await flush();
    await assertContext(mark('c'), contextHeld, 4);
    await touch('touchMove', { x: contextHeld.x + 45, y: contextHeld.y + 30 });
    await touch('touchEnd', contextHeld); await flush();
    assert.deepEqual(await centre(mark('c')), contextHeld, 'moving after a context long press does not drag the mark');
    await assertContext(mark('c'), contextHeld, 4);
    await touch('touchStart', contextHeld); await touch('touchCancel', contextHeld);
    await page.waitForTimeout(600); await flush();
    assert.equal((await page.evaluate(() => window.contextMenus)).length, 4, 'cancelling a hold retires its context timer');

    const canvas = await page.locator('#map svg').boundingBox();
    await page.mouse.click(canvas.x + 4, canvas.y + 4, { button: 'right' }); await flush();
    assert.equal((await page.evaluate(() => window.contextMenus)).length, 4, 'right-clicking the background has no mark context');
    await mark('c').dblclick(); await flush();
    assert.equal((await page.evaluate(() => window.navigated)).length, 5, 'a context callback preserves double-click source navigation');
    assert.equal((await page.evaluate(() => window.contextMenus)).length, 4, 'double-click navigation does not open context actions');
    await context.close(); runs++;
  }
  assert.deepEqual(errors, []);
  console.log(`Map gesture browser checks passed: ${runs} viewports; wording without overlap, snapping guides and Alt, long press and double tap, pointer/keyboard/touch context actions and navigation fallback.`);
} finally {
  await browser.close();
}
