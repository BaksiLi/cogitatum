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
      import { explainSource } from '../../core/src/index.ts';
      import { createReadingView, createGraphView, projectReading, referenceKey } from './index.ts';
      window.mount = (source, mode = 'document') => {
        window.views?.reading.destroy(); window.views?.map.destroy();
        const events = { reading: [], map: [], clear: 0, navigate: [] };
        const compiled = explainSource(source, mode);
        const projection = projectReading(source, compiled);
        const reading = createReadingView(document.querySelector('#reading'), {
          reducedMotion: () => true,
          onSelect: selection => events.reading.push(selection),
          onClear: () => events.clear++,
          onNavigate: selection => events.navigate.push(selection)
        });
        const map = createGraphView(document.querySelector('#map'), {
          reducedMotion: () => true, onSelect: node => events.map.push(node)
        });
        reading.update(projection); map.update(compiled.graphs[0], 'test');
        window.views = { reading, map, events, projection, referenceKey };
      };
    `,
    resolveDir: fileURLToPath(new URL('../src/', import.meta.url)),
  },
  bundle: true, write: false, format: 'iife', platform: 'browser',
});
const browser = await chromium.launch();
const errors = [];
let runs = 0;
try {
  for (const width of [1280, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent('<button id="before">Before</button><div id="reading"></div><div id="map" style="height:500px"></div><button id="after">After</button>');
    await page.addStyleTag({ path: fileURLToPath(new URL('../src/style.css', import.meta.url)) });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const flush = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const mount = async (source, mode) => { await page.evaluate(([source, mode]) => window.mount(source, mode), [source, mode]); await flush(); };
    const row = line => page.locator(`#reading [data-occurrence][data-line="${line}"]`);

    await mount([
      '- [C @shared] Shared prose.', '- [C @other] Other claim.',
      '  - [G use @shared; @local] Local wording.', '- Body only.',
      '  - [note] Untouched quotation.', '    - [C @literal] Literal syntax.',
      '- [_ @shared -> @other; @extra]',
    ].join('\n'));
    assert.equal(await row(3).locator('.cog-reading-text').textContent(), 'Local wording.');
    assert.match(await row(3).locator('.cog-reading-use').textContent(), /Shared prose/);
    await row(3).focus(); await page.keyboard.press('Space');
    await page.evaluate(() => {
      const { reading, projection } = window.views;
      reading.select({ kind: 'point', key: projection.units[0].graph.points[0].key });
    });
    assert.equal(await row(3).getAttribute('aria-pressed'), 'true', 'a Map echo retains the local use');
    assert.equal(await row(1).getAttribute('aria-pressed'), 'false');
    await page.keyboard.press('ArrowRight');
    assert.equal(await row(3).getAttribute('data-selected-reference'), 'bearing');
    await page.locator('#before').focus();
    await row(3).focus(); await flush();
    assert.equal(await row(1).getAttribute('data-related'), 'false', 'the local Bearing does not include other uses of its source Point');
    const bearingGuidance = await page.evaluate(() => {
      const { projection, reading } = window.views;
      const occurrence = projection.units[0].occurrences.find(occurrence => occurrence.line === 3);
      const ref = occurrence.references.find(reference => reference.kind === 'constructs').ref;
      // This silent echo clears hover; focus should already be showing the same neighborhood.
      const before = [...document.querySelectorAll('#reading [data-related]')].map(row => row.dataset.related);
      reading.selectOccurrence(occurrence.id, ref);
      return { before, after: [...document.querySelectorAll('#reading [data-related]')].map(row => row.dataset.related) };
    });
    assert.deepEqual(bearingGuidance.before, bearingGuidance.after, 'refocusing a row retains the selected reference for guidance');

    await page.keyboard.press('Escape');
    assert.equal(await row(3).getAttribute('tabindex'), '0', 'clearing selection retains the focused keyboard entry');
    assert.equal(await page.locator('#reading [aria-pressed="true"]').count(), 0);
    await page.keyboard.press('ArrowDown');
    assert.equal(await row(4).getAttribute('aria-pressed'), 'true');
    assert.equal(await row(4).getAttribute('data-selected-reference'), 'text');
    await page.keyboard.press('End');
    assert.equal(await row(7).getAttribute('aria-pressed'), 'true');
    await page.keyboard.press('ArrowUp');
    assert.equal(await row(6).getAttribute('aria-pressed'), 'true');
    assert.equal(await row(6).locator('.cog-reading-text').textContent(), '[C @literal] Literal syntax.');
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => window.views.events.navigate.at(-1).ref), undefined);
    await page.evaluate(() => {
      const { reading, projection } = window.views;
      reading.update(projection);
    });
    assert.equal(await page.locator('#reading [aria-pressed="true"]').count(), 0, 'updates clear local occurrence identity');

    const mark = page.locator('#map [data-node="point:_p2"]');
    await mark.dispatchEvent('click', { detail: 0 });
    assert.equal(await mark.getAttribute('aria-pressed'), 'true', 'assistive activation selects a Map mark without pointer events');
    assert.equal(await page.evaluate(() => window.views.events.map.length), 1);
    await page.locator('#map [data-node="point:_p1"]').click();
    assert.equal(await page.evaluate(() => window.views.events.map.length), 2, 'a pointer click emits selection once');
    await mark.focus(); await page.keyboard.press('Escape'); await flush();
    assert.equal(await mark.getAttribute('tabindex'), '0', 'Map clearing retains the focused keyboard entry');

    await mount('- [C @same] First.\n  - [G] Reason.\n- [. @alone] Unrelated.');
    await page.locator('#map [data-node="point:_p3"]').dispatchEvent('pointermove');
    await flush();
    await page.evaluate(() => {
      const { map, projection } = window.views;
      map.update(projection.units[0].graph, 'new-unit');
    });
    await flush();
    assert.equal(await page.locator('#map svg').getAttribute('data-guided'), 'false', 'update discards hover keys from the previous projection');

    await mount('- [C @c] First.\n  - [G +> @missing] Preserved prose.\n- [C @c] Duplicate.\n- [_ use @unknown] Local unresolved wording.');
    assert.match(await row(2).locator('.cog-reading-text').textContent(), /^\[G \+> @missing\] Preserved prose\.$/);
    assert.match(await row(4).locator('.cog-reading-text').textContent(), /Local unresolved wording/);
    assert.equal(await row(1).getAttribute('data-selected-reference'), '');
    await row(1).focus(); await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => window.views.events.navigate.at(-1).ref), undefined, 'a rejected duplicate is still source, never a graph entity');
    assert.equal(await page.locator('#reading details[hidden]').count(), 0);

    await mount('- [C @p] One.\n- [C @q] Two.\n- [_ @p, @q +> @q; @first]\n- [_ @q, @p +> @q; @second]\n- [_ @p +> @right; @left]\n- [_ @q /> @left; @right]');
    assert.equal(await page.locator('#reading [data-bearing]').count(), 4);
    assert.equal(await page.locator('#map [data-node^="bearing:"]').count(), 4);
    assert.equal(await page.locator('#reading .cog-reading-arc').count(), 10);
    assert.equal(await page.locator('#reading path[d*="NaN"], #map path[d*="NaN"]').count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);

    await mount('```cog\n- [C @same] First unit.\n```\n```cog\n- [C @same] Second unit.\n```', 'host');
    await row(5).focus(); await page.keyboard.press('Space');
    await page.evaluate(() => window.views.reading.select({ kind: 'point', key: '_p1' }, 1));
    assert.equal(await row(5).getAttribute('aria-pressed'), 'true');
    assert.equal(await row(2).getAttribute('aria-pressed'), 'false');
    const contract = await page.evaluate(() => {
      const { reading, events, projection } = window.views;
      const count = events.reading.length;
      let rejected = false;
      try { reading.selectOccurrence(projection.units[1].occurrences[0].id, { kind: 'bearing', key: 'missing' }); }
      catch { rejected = true; }
      reading.selectOccurrence('unknown');
      return { rejected, silent: events.reading.length === count };
    });
    assert.deepEqual(contract, { rejected: true, silent: true });
    assert.equal(await page.locator('#reading [aria-pressed="true"]').count(), 0, 'an unknown occurrence clears rather than guessing');
    await page.evaluate(() => { window.views.reading.destroy(); window.views.map.destroy(); });
    assert.equal(await page.locator('.cog-reading, .cog-graph').count(), 0);
    await page.close(); runs++;
  }
  assert.deepEqual(errors, []);
  console.log(`View selection browser checks passed: ${runs} viewports; occurrence echoes, keyboard refs, focus, assistive clicks, partial compilation, cycles, duplicate Bearings, unit scope and cleanup.`);
} finally {
  await browser.close();
}
