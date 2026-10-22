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
      import { explainSource } from '@cogitatum/core';
      import { projectReading, referenceKey } from '@cogitatum/view';
      import { createBlockView } from '@cogitatum/view/block';
      window.mount = (source, editable = true, version) => {
        window.block?.destroy();
        window.requests = []; window.modes = [];
        window.projection = projectReading(source, explainSource(source, 'document'));
        window.block = createBlockView(document.querySelector('#host'), {
          version,
          onMode: mode => window.modes.push(mode),
          ...(editable ? { onEdit: request => new Promise((resolve, reject) => {
            window.requests.push({ ...request, resolve, reject, observed: {
              dialogs: document.querySelectorAll('dialog').length,
              modal: document.querySelectorAll(':modal').length,
              attached: window.block.element.parentElement === document.querySelector('#host'),
              mode: window.block.element.dataset.mode,
              mapRetained: document.querySelector('.cog-graph') === window.savedMap
            } });
            document.querySelector('#editor').focus();
          }) } : {})
        });
        window.block.update(source);
      };
      window.refAt = (line, kind) => referenceKey(window.projection.units[0].occurrences
        .find(row => row.line === line).references.find(reference => reference.ref.kind === kind).ref);
      window.spanAt = line => window.projection.units[0].occurrences.find(row => row.line === line).sourceSpan;
    `,
    resolveDir: fileURLToPath(new URL('../src/', import.meta.url)),
  },
  bundle: true, write: false, format: 'iife', platform: 'browser', conditions: ['development'],
});
const source = [
  '- [C @shared] Shared statement.',
  '- [C @target] Target conclusion.',
  '  - [G use @shared; @route] Local evidence wording.',
  '- Body without a graph identity.',
].join('\n');
const browser = await chromium.launch();
const failures = [], errors = [];
let checks = 0;
try {
  for (const width of [1280, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    page.setDefaultTimeout(3000);
    page.on('pageerror', error => errors.push(`${width}px: ${error.message}`));
    await page.setContent('<input id="editor" aria-label="Native editor"><div id="host" style="width:min(720px,100%);min-height:23px"></div>');
    await page.addStyleTag({ path: fileURLToPath(new URL('../src/style.css', import.meta.url)) });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const root = page.locator('.cog-block');
    const button = name => root.getByRole('button', { name, exact: true });
    const row = line => root.locator(`[data-occurrence][data-line="${line}"]`);
    const flush = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const mount = async (editable = true) => { await page.evaluate(([source, editable]) => window.mount(source, editable), [source, editable]); await flush(); };
    const mark = async (line, kind) => root.locator(`.cog-node[data-node="${await page.evaluate(([line, kind]) => window.refAt(line, kind), [line, kind])}"]`);
    const settleRequest = async (index, reject = false) => page.evaluate(async ([index, reject]) => {
      const request = window.requests[index];
      if (reject) request.reject(new Error('Obsolete editor failure')); else request.resolve();
      await Promise.resolve();
    }, [index, reject]);
    const assertRequest = async (index, line) => {
      const actual = await page.evaluate(index => {
        const { source, sourceSpan, signal } = window.requests[index];
        return { source, sourceSpan, aborted: signal.aborted };
      }, index);
      assert.deepEqual(actual, { source, sourceSpan: await page.evaluate(line => window.spanAt(line), line), aborted: false });
    };
    const check = async (name, run) => {
      try { await run(); checks++; }
      catch (error) { failures.push(new Error(`${width}px: ${name}: ${error.message}`, { cause: error })); }
      finally { await page.evaluate(() => window.block?.destroy()); }
    };

    await check('Reading/Map occurrence and edit target preservation', async () => {
      await mount();
      assert.equal(await root.locator('.cog-graph').count(), 0, 'Map is created only when requested');
      await row(3).focus(); await page.keyboard.press('Space');
      await button('Map').click(); await flush();
      const shared = await mark(3, 'point');
      assert.equal(await shared.getAttribute('aria-pressed'), 'true');
      await shared.dispatchEvent('click', { detail: 0 });
      await shared.focus(); await page.keyboard.press('Enter');
      await assertRequest(0, 3);
      await settleRequest(0);
      await button('Read passage').click();
      assert.equal(await row(3).getAttribute('aria-pressed'), 'true', 'Map echo retains the local use');
      assert.equal(await row(1).getAttribute('aria-pressed'), 'false');
      assert.equal(await row(3).evaluate(node => node === document.activeElement), true);

      await page.keyboard.press('ArrowRight');
      assert.equal(await row(3).getAttribute('data-selected-reference'), 'bearing');
      await button('Map').click(); await flush();
      const route = await mark(3, 'bearing');
      assert.equal(await route.getAttribute('aria-pressed'), 'true', 'switching mode preserves the chosen Bearing reference');
      await route.focus(); await page.keyboard.press('Enter');
      await assertRequest(1, 3);
      await settleRequest(1);
      await button('Read passage').click();
      assert.equal(await row(3).getAttribute('data-selected-reference'), 'bearing');

      await button('Map').click();
      const target = await mark(2, 'point');
      await target.dispatchEvent('click', { detail: 0 });
      await button('Edit').click(); await assertRequest(2, 2); await settleRequest(2);
      await button('Read passage').click();
      assert.equal(await row(2).getAttribute('aria-pressed'), 'true', 'a different Map target selects its own passage');
      await row(4).focus(); await page.keyboard.press('Space');
      await button('Map').click();
      assert.equal(await root.locator('.cog-node[aria-pressed="true"]').count(), 0, 'body prose clears the graph selection');
      await button('Edit').click(); await assertRequest(3, 4);
    });

    await check('optional Edit absence', async () => {
      await mount(false);
      assert.equal(await button('Edit').count(), 0);
      await row(3).focus(); await page.keyboard.press('Enter');
      await button('Map').click(); await flush();
      const shared = await mark(3, 'point');
      await shared.focus(); await page.keyboard.press('Enter');
      assert.equal(await shared.getAttribute('aria-pressed'), 'true');
      assert.equal(await page.evaluate(() => window.requests.length), 0);
      assert.doesNotMatch(await root.locator('.cog-block-hint').textContent(), /edit/i);
    });

    await check('pending edits suppress duplicates and abort by revision', async () => {
      await mount();
      await row(3).focus(); await page.keyboard.press('Enter');
      await assertRequest(0, 3);
      assert.equal(await button('Edit').isDisabled(), true);
      assert.equal(await button('Edit').getAttribute('aria-busy'), 'true');
      await button('Edit').evaluate(node => node.click());
      await row(3).focus(); await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
      assert.equal(await page.evaluate(() => window.requests.length), 1);
      await page.evaluate(source => window.block.update(source), source);
      assert.equal(await page.evaluate(() => window.requests[0].signal.aborted), false, 'an unchanged source is not a new revision');
      const revised = `${source}\n- [C @new] New revision.`;
      assert.deepEqual(await page.evaluate(source => {
        window.block.update(source);
        return { aborted: window.requests[0].signal.aborted, disabled: document.querySelector('button[aria-busy]') !== null };
      }, revised), { aborted: true, disabled: false });
      await button('Edit').click();
      assert.deepEqual(await page.evaluate(() => {
        const { source, sourceSpan, signal } = window.requests[1];
        return { source, sourceSpan, aborted: signal.aborted };
      }), { source: revised, sourceSpan: undefined, aborted: false });
      await settleRequest(0, true);
      assert.equal(await button('Edit').isDisabled(), true, 'completion of an obsolete request cannot unlock the current request');
      assert.equal(await root.getByRole('status').count(), 0, 'an obsolete rejection does not show an error');
      assert.deepEqual(await page.evaluate(() => {
        window.block.destroy();
        return { aborted: window.requests[1].signal.aborted, blocks: document.querySelectorAll('.cog-block').length };
      }), { aborted: true, blocks: 0 });
      await settleRequest(1, true);
    });

    await check('Expand then Edit closes synchronously and preserves Map', async () => {
      await mount();
      await row(3).focus(); await page.keyboard.press('Space');
      await button('Map').click(); await flush();
      await button('Zoom in').click(); await flush();
      const before = await page.evaluate(() => {
        window.savedMap = document.querySelector('.cog-graph');
        return [...window.savedMap.querySelectorAll('.cog-node')].map(node => node.getAttribute('transform'));
      });
      await button('Expand').click(); await flush();
      assert.equal(await page.locator('dialog:modal').count(), 1);
      assert.equal(await page.evaluate(() => document.querySelector('.cog-graph') === window.savedMap), true);
      await button('Edit').click();
      await assertRequest(0, 3);
      assert.deepEqual(await page.evaluate(() => window.requests[0].observed), {
        dialogs: 0, modal: 0, attached: true, mode: 'map', mapRetained: true,
      }, 'the modal is gone before the native editor callback runs');
      assert.equal(await page.locator('#editor').evaluate(node => node === document.activeElement), true);
      assert.equal(await page.locator('#host').evaluate(node => node.style.minHeight), '23px');
      await flush();
      assert.deepEqual(await page.evaluate(() => [...window.savedMap.querySelectorAll('.cog-node')].map(node => node.getAttribute('transform'))), before);
      await button('Expand').click();
      assert.deepEqual(await page.evaluate(() => {
        const modalBefore = document.querySelectorAll('dialog:modal').length;
        window.block.destroy();
        return {
          modalBefore, dialogs: document.querySelectorAll('dialog').length,
          modal: document.querySelectorAll(':modal').length, blocks: document.querySelectorAll('.cog-block').length,
          minHeight: document.querySelector('#host').style.minHeight, aborted: window.requests[0].signal.aborted,
        };
      }), { modalBefore: 1, dialogs: 0, modal: 0, blocks: 0, minHeight: '23px', aborted: true }, 'destroy removes the expanded dialog in the same call');
      await settleRequest(0);
    });

    await check('layout responds to container width independently of viewport', async () => {
      await mount();
      await page.locator('#host').evaluate(node => { node.style.width = '320px'; });
      await button('Map').click(); await flush();
      assert.equal(await page.evaluate(() => innerWidth), width);
      assert.equal(await root.locator('.cog-block-title').isVisible(), false);
      assert.equal(await root.locator('.cog-block-map').evaluate(node => node.getBoundingClientRect().height), 340);
      const assertContained = async () => {
        assert.equal(await root.evaluate(node => node.scrollWidth <= node.clientWidth + 1), true);
        assert.equal(await root.evaluate(node => {
          const box = node.getBoundingClientRect();
          return [...node.querySelectorAll('button')].filter(button => button.getClientRects().length).every(button => {
            const rect = button.getBoundingClientRect();
            return rect.left >= box.left && rect.right <= box.right;
          });
        }), true, 'all visible controls fit the actual container');
      };
      await assertContained();
      await button('Reading').click(); await flush(); await assertContained();
      if (width > 720) {
        await page.locator('#host').evaluate(node => { node.style.width = '720px'; });
        await button('Map').click(); await flush();
        assert.equal(await page.evaluate(() => innerWidth), width);
        assert.equal(await root.locator('.cog-block-title').isVisible(), true);
        assert.equal(await root.locator('.cog-block-map').evaluate(node => node.getBoundingClientRect().height), 390);
        await assertContained();
      }
    });
    await check('optional build stamp opens with the keyboard and fits a narrow host', async () => {
      await mount();
      assert.equal(await root.locator('.cog-block-version').count(), 0);
      const version = { label: 'Core candidate', detail: 'Core candidate\nView candidate\nSource ' + 'a'.repeat(40) };
      await page.evaluate(([source, version]) => window.mount(source, true, version), [source, version]);
      const stamp = root.locator('.cog-block-version');
      await page.locator('#host').evaluate(node => { node.style.width = '280px'; });
      assert.equal(await stamp.locator('p').isVisible(), false);
      await stamp.locator('summary').focus(); await page.keyboard.press('Enter');
      assert.equal(await stamp.locator('p').isVisible(), true);
      assert.equal(await stamp.locator('p').textContent(), version.detail);
      await flush();
      assert.equal(await root.evaluate(node => node.scrollWidth <= node.clientWidth + 1), true);
      await page.keyboard.press('Space');
      assert.equal(await stamp.locator('p').isVisible(), false);
    });
    await page.close();
  }
  assert.deepEqual(errors, [], 'browser runtime errors');
  if (failures.length) throw new AggregateError(failures, `${failures.length} shared block browser checks failed; ${checks} passed`);
  console.log(`Shared block browser checks passed: ${checks} cases at 2 viewports; real Core/View, local occurrences and edit targets, optional Edit, pending edits, aborts, modal cleanup, Map preservation and container widths.`);
} finally {
  await browser.close();
}
