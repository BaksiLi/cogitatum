import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const { build } = require('esbuild');
const bundle = await build({
  stdin: {
    contents: `
      import { createProseScope } from './prose.ts';
      import { createBlockView } from './block.ts';
      window.createProseScope = createProseScope;
      window.createBlockView = createBlockView;
    `,
    resolveDir: fileURLToPath(new URL('../src/', import.meta.url)),
  },
  bundle: true, write: false, format: 'iife', platform: 'browser', conditions: ['development'],
});
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 900 }, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setContent('<div id="host"></div>');
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const result = await page.evaluate(async () => {
    const host = document.querySelector('#host');
    const a = document.createElement('div'), b = document.createElement('div');
    host.append(a, b);
    const facts = {};
    const unsafe = '<img src=x onerror=alert(1)> **plain**';
    const plain = window.createProseScope();
    plain.render(a, unsafe);
    facts.safeFallback = a.textContent === unsafe && !a.querySelector('img');
    plain.reset(); facts.plainReset = a.childNodes.length === 0;
    plain.destroy(); plain.render(a, 'ignored');
    facts.destroyIsFinal = a.childNodes.length === 0;

    let layouts = 0, cleanups = 0;
    const sync = window.createProseScope(({ container, text }) => {
      const p = container.ownerDocument.createElement('p'); p.textContent = text; container.append(p);
      return () => { cleanups++; };
    }, () => { layouts++; });
    sync.render(a, 'One paragraph');
    facts.blockStage = a.firstElementChild.tagName === 'DIV' && a.querySelector('p')?.textContent === 'One paragraph';
    facts.syncLayout = layouts === 1;
    sync.render(a, 'Replacement');
    facts.replacementCleanup = cleanups === 1;
    sync.reset(); sync.reset(); sync.destroy(); sync.destroy();
    facts.onceCleanup = cleanups === 2;

    let rejectedSignal;
    const throwing = window.createProseScope(({ container, signal }) => {
      rejectedSignal = signal; container.innerHTML = '<p>Partial host output</p>'; throw Error('Host failed');
    });
    throwing.render(a, unsafe);
    facts.throwFallback = a.textContent === unsafe && !a.querySelector('*') && rejectedSignal.aborted;
    throwing.reset(); facts.failedReset = !a.childNodes.length;
    throwing.destroy();

    const pending = [];
    const asyncScope = window.createProseScope(request => new Promise((resolve, reject) => {
      pending.push({ ...request, resolve, reject, cleaned: 0 });
    }), () => { layouts++; });
    const settle = async (request, value = 'Late output') => {
      const p = request.container.ownerDocument.createElement('p'); p.textContent = value; request.container.append(p);
      request.resolve(() => { request.cleaned++; });
      await Promise.resolve();
    };
    asyncScope.render(a, 'Old');
    facts.isolatedWhilePending = a.textContent === 'Old' && !pending[0].container.isConnected;
    asyncScope.render(a, 'New');
    await settle(pending[0]);
    facts.lateReplacement = pending[0].signal.aborted && pending[0].cleaned === 1 && a.textContent === 'New';
    await settle(pending[1], 'Current rich output');
    facts.asyncCommit = a.querySelector('div > p')?.textContent === 'Current rich output';
    asyncScope.render(b, 'Other');
    asyncScope.reset();
    facts.resetAll = pending[1].signal.aborted && pending[1].cleaned === 1 && pending[2].signal.aborted && !a.childNodes.length && !b.childNodes.length;
    asyncScope.render(b, 'After reset');
    await settle(pending[2]);
    facts.lateReset = pending[2].cleaned === 1 && b.textContent === 'After reset';
    pending[3].reject(Error('Async host failed'));
    await Promise.resolve();
    facts.rejectFallback = pending[3].signal.aborted && b.textContent === 'After reset' && !b.querySelector('*');
    asyncScope.render(a, 'Before destroy');
    const beforeDestroyLayouts = layouts;
    asyncScope.destroy();
    a.textContent = 'New owner';
    await settle(pending[4]);
    facts.lateDestroy = pending[4].signal.aborted && pending[4].cleaned === 1 && a.textContent === 'New owner' && layouts === beforeDestroyLayouts;

    const lateRejections = [];
    const rejected = window.createProseScope(() => new Promise((resolve, reject) => lateRejections.push(reject)));
    rejected.render(a, 'Obsolete'); rejected.reset(); a.textContent = 'Fresh';
    lateRejections[0](Error('Obsolete failure')); await Promise.resolve();
    facts.lateRejection = a.textContent === 'Fresh'; rejected.destroy();

    const cleanupSignals = [];
    const cleanupFailure = window.createProseScope(({ signal }) => {
      cleanupSignals.push(signal);
      return () => { throw Error('Broken cleanup'); };
    });
    cleanupFailure.render(a, 'A'); cleanupFailure.render(b, 'B'); cleanupFailure.reset();
    facts.cleanupIsolation = cleanupSignals.every(signal => signal.aborted) && !a.childNodes.length && !b.childNodes.length;
    cleanupFailure.destroy();

    let reentrantCleanup = 0;
    const reentrant = window.createProseScope(() => {
      reentrant.reset(); return () => { reentrantCleanup++; };
    });
    reentrant.render(a, 'Cancelled inside renderer');
    facts.reentrantCancel = !a.childNodes.length && reentrantCleanup === 1;
    reentrant.destroy();
    host.replaceChildren();
    return facts;
  });
  for (const [name, passed] of Object.entries(result)) assert.equal(passed, true, name);

  // The shared block uses the same scope for full Map detail, while compact SVG labels stay plain.
  const source = '- [C @first] **First** complete prose.\n- [C @second] Second prose.';
  await page.evaluate(source => {
    window.renders = [];
    window.block = window.createBlockView(document.querySelector('#host'), {
      renderProse: request => new Promise(resolve => { window.renders.push({ ...request, resolve, cleaned: 0 }); }),
    });
    window.block.update(source);
  }, source);
  await page.getByRole('button', { name: 'Map', exact: true }).click();
  const points = page.locator('.cog-node.point');
  await points.nth(0).dispatchEvent('click', { detail: 0 });
  const firstIndex = await page.evaluate(() => window.renders.length - 1);
  assert.equal(await page.locator('.cog-block-detail-heading').textContent(), 'Claim @first');
  assert.equal(await page.locator('.cog-block-detail-text').textContent(), '**First** complete prose.');
  assert.equal(await page.locator('.cog-block-detail-text').evaluate(node => node.tagName), 'DIV');
  await points.nth(1).dispatchEvent('click', { detail: 0 });
  const secondIndex = await page.evaluate(() => window.renders.length - 1);
  assert.equal(await page.evaluate(index => window.renders[index].signal.aborted, firstIndex), true);
  await page.evaluate(async index => {
    const request = window.renders[index]; request.container.textContent = 'Obsolete rich prose';
    request.resolve(() => { request.cleaned++; }); await Promise.resolve();
  }, firstIndex);
  assert.equal(await page.locator('.cog-block-detail-text').textContent(), 'Second prose.');
  assert.equal(await page.evaluate(index => window.renders[index].cleaned, firstIndex), 1);
  await page.evaluate(async index => {
    const request = window.renders[index];
    const p = document.createElement('p'); p.textContent = 'Native paragraph'; request.container.append(p);
    request.resolve(() => { request.cleaned++; }); await Promise.resolve();
  }, secondIndex);
  assert.equal(await page.locator('.cog-block-detail-text p').textContent(), 'Native paragraph');
  assert.equal(await page.locator('.cog-graph strong, .cog-graph p').count(), 0);
  await points.nth(1).focus(); await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(index => window.renders[index].cleaned, secondIndex), 1);
  assert.equal(await page.locator('.cog-block-detail').isHidden(), true);
  await points.nth(0).dispatchEvent('click', { detail: 0 });
  const updateIndex = await page.evaluate(() => window.renders.length - 1);
  await page.evaluate(source => window.block.update(source + '\n- New body.'), source);
  assert.equal(await page.evaluate(index => window.renders[index].signal.aborted, updateIndex), true);
  await points.nth(0).dispatchEvent('click', { detail: 0 });
  const destroyIndex = await page.evaluate(() => window.renders.length - 1);
  await page.evaluate(() => window.block.destroy());
  assert.equal(await page.evaluate(index => window.renders[index].signal.aborted, destroyIndex), true);
  assert.equal(await page.locator('.cog-block').count(), 0);

  await page.evaluate(() => {
    window.renders = [];
    window.block = window.createBlockView(document.querySelector('#host'), {
      renderProse: request => { window.renders.push(request); request.container.textContent = request.text; },
    });
    window.block.update('- [C @first] C\n- [C @second] Target.\n- [G +>] **Invalid** prose.\n- [_ @first +> @second; @route]');
  });
  await page.getByRole('button', { name: 'Map', exact: true }).click();
  await page.locator('.cog-node.point').nth(0).dispatchEvent('click', { detail: 0 });
  assert.equal(await page.locator('.cog-block-detail-text').textContent(), 'C', 'Prose equal to the compact role label is still authored prose');
  const beforeInvalid = await page.evaluate(() => window.renders.length);
  await page.locator('.cog-node.point').nth(2).dispatchEvent('click', { detail: 0 });
  assert.equal(await page.locator('.cog-block-detail-text').textContent(), '**Invalid** prose.');
  assert.equal(await page.evaluate(() => window.renders.length), beforeInvalid, 'Invalid partial Points do not reach the prose hook');
  await page.locator('.cog-node.bearing').dispatchEvent('click', { detail: 0 });
  assert.equal(await page.locator('.cog-block-detail-text').textContent(), '', 'A Bearing without prose clears an earlier plain fallback');
  assert.equal(await page.evaluate(() => window.renders.length), beforeInvalid);
  await page.evaluate(() => window.block.destroy());
  assert.deepEqual(errors, [], 'browser runtime errors');
  console.log(`Prose browser checks passed: ${Object.keys(result).length} scope invariants; Map detail lifecycle, block markup and compact labels.`);
} finally { await browser.close(); }
