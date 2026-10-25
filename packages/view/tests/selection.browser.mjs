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
      window.mount = (source, mode = 'document', navigateDiagnostics = true) => {
        window.views?.reading.destroy(); window.views?.map.destroy();
        const events = { reading: [], map: [], clear: 0, navigate: [], diagnostic: [] };
        const compiled = explainSource(source, mode);
        const projection = projectReading(source, compiled);
        const readingOptions = {
          reducedMotion: () => true,
          onSelect: selection => events.reading.push(selection),
          onClear: () => events.clear++,
          onNavigate: selection => events.navigate.push(selection)
        };
        if (navigateDiagnostics) {
          readingOptions.onNavigateDiagnostic = diagnostic => events.diagnostic.push(diagnostic);
        }
        const reading = createReadingView(document.querySelector('#reading'), readingOptions);
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
    const mount = async (source, mode = 'document', navigateDiagnostics = true) => {
      await page.evaluate(([source, mode, navigateDiagnostics]) => window.mount(source, mode, navigateDiagnostics), [source, mode, navigateDiagnostics]);
      await flush();
    };
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
    assert.equal(await row(3).getAttribute('data-selected'), 'true', 'a Map echo retains the local use');
    assert.equal(await row(1).getAttribute('data-selected'), 'false');
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
    assert.equal(await row(4).getAttribute('data-selected'), 'true');
    assert.equal(await row(4).getAttribute('data-selected-reference'), 'text');
    await page.keyboard.press('End');
    assert.equal(await row(7).getAttribute('data-selected'), 'true');
    await page.keyboard.press('ArrowUp');
    assert.equal(await row(6).getAttribute('data-selected'), 'true');
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

    // A source revision retires the captured gesture before compilation keys can be reused.
    const drag = page.locator('#map [data-node="point:_p1"]');
    await drag.evaluate(node => node.ownerSVGElement.addEventListener('pointerdown', event => {
      window.dragPointer = event.pointerId;
    }, { once: true }));
    const box = await drag.boundingBox();
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x + 35, y + 15, { steps: 3 });
    assert.equal(await page.locator('#map svg').getAttribute('data-dragging'), 'node');
    await page.evaluate(() => {
      window.views.map.update(window.views.projection.units[0].graph, 'replacement');
    });
    const replacement = await drag.getAttribute('transform');
    assert.equal(await page.locator('#map svg').getAttribute('data-dragging'), null);
    assert.equal(await page.locator('#map svg').evaluate(svg => svg.hasPointerCapture(window.dragPointer)), false);
    await page.mouse.move(x + 70, y + 30); await page.mouse.up(); await flush();
    assert.equal(await drag.getAttribute('transform'), replacement, 'retired pointer movement cannot move the replacement node');
    await drag.dispatchEvent('click', { detail: 0 });
    assert.equal(await drag.getAttribute('aria-pressed'), 'true', 'assistive activation still works after gesture cancellation');

    await mount('- [C @same] First.\n  - [G] Reason.\n- [. @alone] Unrelated.');
    await page.locator('#map [data-node="point:_p3"]').dispatchEvent('pointermove');
    await flush();
    await page.evaluate(() => {
      const { map, projection } = window.views;
      map.update(projection.units[0].graph, 'new-unit');
    });
    await flush();
    assert.equal(await page.locator('#map svg').getAttribute('data-guided'), 'false', 'update discards hover keys from the previous projection');

    // Shared Reading diagnostics expose compiler explanations and host-owned source navigation.
    await mount('- [C @same] First.\n- [C @same] Second.');
    const diagnosticButton = page.locator('.cog-reading-diagnostics .cog-reading-diagnostic-source');
    assert.equal(await diagnosticButton.count(), 1);
    assert.match(
      await page.locator('.cog-reading-diagnostics .cog-reading-diagnostic-explanation').textContent(),
      /If this line means the existing Point/
    );
    await page.locator('.cog-reading-diagnostics summary').click();
    await diagnosticButton.click();
    assert.deepEqual(await page.evaluate(() => {
      const { events, projection } = window.views;
      const received = events.diagnostic.at(-1);
      const original = projection.diagnostics.find(diagnostic => diagnostic.code === 'DUPLICATE_ID');
      return { identity: received === original, span: received.sourceSpan, code: received.code };
    }), {
      identity: true,
      span: { startLine: 2, startColumn: 3, endLine: 2, endColumn: 20 },
      code: 'DUPLICATE_ID'
    });

    const oldButton = await diagnosticButton.elementHandle();
    await page.evaluate(() => window.views.reading.update(window.views.projection));
    await oldButton.evaluate(node => node.click());
    assert.equal(await page.evaluate(() => window.views.events.diagnostic.length), 1, 'updating Reading retires the old diagnostic control');
    await diagnosticButton.click();
    assert.equal(await page.evaluate(() => window.views.events.diagnostic.length), 2, 'the replacement control still navigates');

    await page.evaluate(() => {
      const { reading, projection } = window.views;
      const original = projection.diagnostics.find(diagnostic => diagnostic.code === 'DUPLICATE_ID');
      reading.update({ ...projection, diagnostics: [{ ...original, sourceSpan: undefined }] });
    });
    await flush();
    assert.equal(await diagnosticButton.count(), 0, 'a diagnostic without a source span has no navigation button');
    assert.equal(
      await page.locator('.cog-reading-diagnostics .cog-reading-diagnostic-explanation').count(), 1
    );

    await mount('- [C @same] First.\n- [C @same] Second.');
    const currentButton = await diagnosticButton.elementHandle();
    await page.locator('.cog-reading-diagnostics summary').click();
    await page.evaluate(() => window.views.reading.destroy());
    await currentButton.evaluate(node => node.click());
    assert.equal(await page.evaluate(() => window.views.events.diagnostic.length), 0, 'destroying Reading retires diagnostic controls');

    await mount('- [C @same] First.\n- [C @same] Second.', 'document', false);
    assert.equal(await diagnosticButton.count(), 0, 'without a host callback Reading stays static');
    await page.evaluate(() => { window.views.reading.destroy(); window.views.map.destroy(); });

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

    await mount([
      '- [G @p1] First reason.', '- [G @p2] Second reason.',
      '- [G @s] Third reason.', '- [C @g] The conclusion.',
      '- [edge @p1, @p2, @s +> @g; @route] **Authored description**.',
      '- [O @reservation /> @route] A reservation about this step.',
      '- [edge @p1 clarifies @g; @exposition]',
    ].join('\n'));
    const summary = row(5).locator('.cog-reading-relation');
    assert.equal(await summary.locator('.cog-reading-relation-kind').textContent(), 'jointly supports');
    assert.deepEqual(await summary.locator('[data-ref-kind="point"]').allTextContents(), ['@p1', '@p2', '@s', '@g']);
    assert.equal(await summary.locator('[data-ref-kind="bearing"]').textContent(), '@route');
    assert.equal(await row(5).locator('.cog-reading-text').textContent(), '**Authored description**.', 'without a renderer prose remains safe plain text');
    assert.doesNotMatch(await row(5).textContent(), /;@route|\bBEARING\b/);
    assert.match(await row(7).locator('.cog-reading-relation').textContent(), /clarifies.*@exposition.*@p1.*@g/);
    assert.equal(await row(7).locator('.cog-reading-text').textContent(), '');
    assert.equal(await page.evaluate(() => window.views.projection.units[0].graph.bearings[0].sources.length), 3, 'one joint Bearing retains all three sources');
    assert.equal(await row(5).getAttribute('role'), 'group', 'prose and its controls are outside button semantics');
    await summary.getByRole('button', { name: 'Point @g, line 4', exact: true }).click();
    assert.equal(await row(4).getAttribute('data-selected'), 'true');
    const handle = summary.getByRole('button', { name: 'Bearing @route, line 5', exact: true });
    await handle.click(); await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => window.views.events.navigate.at(-1).sourceSpan.startLine), 5);
    assert.equal(await row(5).getAttribute('data-selected-reference'), 'bearing');
    await row(6).locator('.cog-reading-relation [data-ref-kind="bearing"]').click();
    assert.equal(await row(5).getAttribute('data-selected-reference'), 'bearing', 'a Bearing target selects its own construction');
    assert.equal(await row(5).getAttribute('data-selected'), 'true');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);

    await mount('- [C] Anonymous conclusion.\n  - [G] Anonymous reason.');
    assert.deepEqual(await row(2).locator('.cog-reading-relation [data-ref-kind="point"]').allTextContents(), [
      'L2 · Anonymous reason.', 'L1 · Anonymous conclusion.'
    ]);

    await mount('- [C @p] Evidence.\n- [C @q] Conclusion.\n- [edge @p +> @q; @route]\n- [_ use @route] Local note about the same step.');
    assert.match(await row(4).locator('.cog-reading-use').textContent(), /supports.*@route.*@p.*@q/);
    assert.equal(await row(4).locator('.cog-reading-text').textContent(), 'Local note about the same step.');
    await row(4).locator('[data-ref-kind="bearing"]').click();
    await page.evaluate(() => window.views.reading.select(window.views.projection.units[0].occurrences[3].references[0].ref));
    assert.equal(await row(4).getAttribute('data-selected'), 'true', 'a Map echo retains the local Bearing use');
    assert.equal(await row(3).getAttribute('data-selected'), 'false');

    await mount('- [C @target] Conclusion.\n  - [G @reason; @route] A reason and its support.');
    await row(2).focus(); await page.keyboard.press('Space');
    assert.equal(await row(2).getAttribute('data-selected-reference'), 'point');
    const sameRowHandle = row(2).locator('[data-ref-kind="bearing"]');
    await sameRowHandle.focus(); await page.keyboard.press('Enter');
    assert.equal(await row(2).getAttribute('data-selected-reference'), 'bearing', 'keyboard activation uses the focused typed reference');
    assert.equal(await page.evaluate(() => window.views.events.navigate.at(-1).ref.kind), 'bearing');
    await row(2).focus(); await page.keyboard.press('ArrowLeft');
    assert.equal(await row(2).getAttribute('data-selected-reference'), 'point');
    await sameRowHandle.focus(); await page.keyboard.press('Space');
    assert.equal(await row(2).getAttribute('data-selected-reference'), 'bearing');

    await mount('```cog\n- [C @same] First unit.\n```\n```cog\n- [C @same] Second unit.\n```', 'host');
    await row(5).focus(); await page.keyboard.press('Space');
    await page.evaluate(() => window.views.reading.select({ kind: 'point', key: '_p1' }, 1));
    assert.equal(await row(5).getAttribute('data-selected'), 'true');
    assert.equal(await row(2).getAttribute('data-selected'), 'false');
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

    const chain = count => Array.from({ length: count }, (_, i) =>
      `${'  '.repeat(i)}- [${i ? 'G' : 'C'}] Point ${i + 1} has wording that wraps over several lines.`).join('\n');
    const mapGeometry = () => page.locator('#map svg').evaluate(svg => {
      const box = svg.getBoundingClientRect();
      const rect = node => {
        const r = node.getBoundingClientRect();
        return { left: r.left - box.left, right: r.right - box.left, top: r.top - box.top, bottom: r.bottom - box.top };
      };
      const points = [...svg.querySelectorAll('.cog-node.point')];
      return {
        width: box.width, height: box.height,
        points: points.map(rect),
        positions: points.map(node => node.getAttribute('transform')),
        nodes: [...svg.querySelectorAll('.cog-node')].map(rect),
        spacing: points[1]?.transform.baseVal.consolidate().matrix.f - points[0]?.transform.baseVal.consolidate().matrix.f,
        focused: svg.contains(document.activeElement) ? rect(document.activeElement) : undefined,
      };
    });
    const assertInside = (rect, map, message) => assert.ok(
      rect.left >= -1 && rect.right <= map.width + 1 && rect.top >= -1 && rect.bottom <= map.height + 1,
      `${message}: ${JSON.stringify(rect)} inside ${map.width} × ${map.height}`
    );
    await mount(chain(10));
    const opening = await mapGeometry();
    if (width > 600) {
      assert.ok(opening.spacing > 100, 'a tall Map initially retains reading scale');
      assert.ok(opening.points.at(-1).bottom > opening.height, 'the opening is a readable crop, not the overview');
    }
    await page.locator('#map .cog-node.point').first().focus(); await flush();
    assert.deepEqual((await mapGeometry()).positions, opening.positions, 'focusing a visible mark leaves the camera in place');
    const scroll = await page.evaluate(() => scrollY);
    const steps = await page.locator('#map .cog-node').count();
    // Include the wrap back to the first mark, revealing both ends of the tall drawing.
    for (let i = 0; i < steps; i++) {
      await page.keyboard.press('ArrowDown'); await flush();
      const map = await mapGeometry();
      assertInside(map.focused, map, 'keyboard focus and its wording stay in the Map');
      assert.ok(Math.abs(map.spacing - opening.spacing) < .2, 'keyboard reveal pans without changing zoom');
      assert.equal(await page.evaluate(() => scrollY), scroll, 'keyboard reveal does not scroll the host');
    }
    await page.keyboard.press('Alt+ArrowUp'); await flush();
    const moved = await mapGeometry();
    assertInside(moved.focused, moved, 'keyboard arrangement also reveals the moved mark');

    await page.locator('#before').focus();
    // This chain needs a scale below the manual zoom minimum to fit in either viewport.
    await mount(chain(30));
    await page.evaluate(() => window.views.map.fit()); await flush();
    const overview = await mapGeometry();
    for (const node of overview.nodes) assertInside(node, overview, 'explicit Fit includes every Point and Bearing');
    await page.evaluate(() => window.views.map.zoom(.8)); await flush();
    const zoomedOut = await mapGeometry();
    assert.ok(zoomedOut.spacing <= overview.spacing + .1, 'Zoom out never zooms in from a fitted overview');
    await page.evaluate(() => window.views.map.zoom(1.25)); await flush();
    const zoomedIn = await mapGeometry();
    assert.ok(zoomedIn.spacing > zoomedOut.spacing + .1, 'Zoom in increases scale from a fitted overview');
    await page.evaluate(() => window.views.map.resetLayout()); await flush();
    const reset = await mapGeometry();
    assert.ok(reset.spacing > overview.spacing * 2, 'Arrange restores the reading-scale opening');

    for (const fontSize of [16, 24]) {
      const style = await page.addStyleTag({ content: `#map .cog-text { font-size: ${fontSize}px; }` });
      await mount('- [C] A long passage with enough wording to occupy three lines in the graph caption, so the host font determines their spacing.');
      const lines = await page.locator('#map .cog-text tspan').evaluateAll(nodes => nodes.map(node => ({
        baseline: Number(node.getAttribute('y')), top: node.getBoundingClientRect().top, bottom: node.getBoundingClientRect().bottom,
      })));
      assert.equal(lines.length, 3);
      for (let i = 1; i < lines.length; i++) {
        assert.ok(Math.abs(lines[i].baseline - lines[i - 1].baseline - Math.round(fontSize * 1.28)) < .01,
          'label baselines use the attached probe’s host font size');
        assert.ok(lines[i].top >= lines[i - 1].bottom, 'larger host fonts do not overlap adjacent caption lines');
      }
      await style.evaluate(node => node.remove());
    }
    await page.evaluate(() => { window.views.reading.destroy(); window.views.map.destroy(); });
    assert.equal(await page.locator('.cog-reading, .cog-graph').count(), 0);
    await page.close(); runs++;
  }
  assert.deepEqual(errors, []);
  console.log(`View selection browser checks passed: ${runs} viewports; occurrence echoes, keyboard refs, Map Fit and focus reveal, host typography, assistive clicks, partial compilation, cycles, duplicate Bearings, unit scope and cleanup.`);
} finally {
  await browser.close();
}
