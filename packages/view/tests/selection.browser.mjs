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
const alternativeRoutes = [
  '- [C @water] Broad Street 水泵可能是這次霍亂暴發的來源。',
  '- [G @cluster] 多數死亡病例集中在水泵周邊。',
  '- [edge @cluster +> @water; @proximity] 地理上的接近，可能反映飲用該水泵水的機會。',
  '- [O @exceptions -> @proximity] 附近濟貧院與啤酒廠幾乎沒有病例。',
  '- [G @exposure] 這兩處不用該水泵；一些遠處患者卻曾飲用泵水。',
  '- [edge @cluster, @exposure +> @water; @water-route] 真正重要的是飲水暴露，而不只是地理位置。',
].join('\n');
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

    await mount('- [C @p] One.\n- [C @q] Two.\n- [_ @p, @q +> @q; @first]\n- [_ @q, @p +> @q; @second]\n- [_ @p +> @right; @left]\n- [_ @q -> @left; @right]');
    assert.equal(await page.locator('#reading [data-bearing]').count(), 4);
    assert.equal(await page.locator('#map [data-node^="bearing:"]').count(), 4);
    assert.equal(await page.locator('#reading .cog-reading-arc').count(), 10);
    assert.equal(await page.locator('#reading path[d*="NaN"], #map path[d*="NaN"]').count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);

    await mount([
      '- [G @p1] First reason.', '- [G @p2] Second reason.',
      '- [G @s] Third reason.', '- [C @g] The conclusion.',
      '- [edge @p1, @p2, @s +> @g; @route] **Authored description**.',
      '- [O @reservation -> @route] A reservation about this step.',
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

    const versions = [
      '- [. @before] Original clause.', '- [. @after] Revised clause.',
      '- [Q @change] Has the scope changed?',
    ].join('\n');
    await mount(versions + [
      '', '- [_ @after, @before ~> @change; @comparison] Compare the versions.',
      '- [_ @before ~> @change; @original]',
      '- [_ @after ~> @change; @revision]',
      '- [_ @before, @after concerns @comparison; @context] Material concerning the comparison.',
    ].join('\n'));
    const comparison = row(4).locator('.cog-reading-relation');
    assert.deepEqual(await comparison.locator('.cog-reading-endpoints button').allTextContents(), ['@after', '@before', '@change']);
    assert.match(await comparison.locator('.cog-reading-relation-kind').textContent(), /joint.*concerns/);
    assert.equal(await page.locator('#reading .cog-reading-relation[data-kind="concerns"]').count(), 4);
    assert.doesNotMatch((await page.locator('#reading .cog-reading-relation-kind').allTextContents()).join(' '), /support|challenge|inference/i);
    const aboutKeys = await page.evaluate(() => Object.fromEntries(
      window.views.projection.units[0].graph.bearings.map(bearing => [bearing.handle, bearing.key])
    ));
    const mapComparison = page.locator(`#map [data-node="bearing:${aboutKeys.comparison}"]`);
    assert.match(await mapComparison.getAttribute('aria-label'), /concerns \(joint, 2 sources\)/);
    assert.equal(await mapComparison.locator('.cog-tone-neutral.cog-junction').count(), 1);
    assert.equal(await page.locator('#map .cog-inline-bearing.cog-concerns').count(), 2, 'independent relevance relations keep separate selectable lines');
    assert.equal(await page.locator('#map .cog-link.cog-tone-neutral.cog-dashed').count(), 8);
    assert.equal(await page.locator('#reading .cog-reading-bearing.cog-tone-neutral .cog-reading-dashed').count(), 8);
    assert.equal(await page.locator(`#map .cog-link.input[data-bearing="${aboutKeys.comparison}"]`).count(), 2);
    assert.equal(await page.locator(`#map .cog-link.output[data-bearing="${aboutKeys.comparison}"]`).count(), 1);
    assert.equal(await page.locator(`#reading [data-bearing="${aboutKeys.comparison}"] .cog-reading-arc`).count(), 3);
    await comparison.getByRole('button', { name: 'Point @after, line 2', exact: true }).click();
    assert.equal(await row(2).getAttribute('data-selected'), 'true', 'the first written source navigates to its own occurrence');
    await row(7).locator('.cog-reading-endpoints').getByRole('button', { name: 'Bearing @comparison, line 4', exact: true }).click();
    assert.equal(await row(4).getAttribute('data-selected-reference'), 'bearing');
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => window.views.events.navigate.at(-1).sourceSpan.startLine), 4);
    await mapComparison.focus(); await page.keyboard.press('Space'); await flush();
    assert.deepEqual(await page.evaluate(() => window.views.events.map.at(-1).ref), { kind: 'bearing', key: aboutKeys.comparison });
    assert.equal(await page.locator('#map .cog-link[data-active="true"]').count(), 6, 'joint focus includes its whole relation and the relation addressing it');
    assert.equal(await page.locator(`#map .cog-link[data-bearing="${aboutKeys.original}"][data-active="true"]`).count(), 0);
    assert.equal(await page.locator(`#map .cog-link[data-bearing="${aboutKeys.revision}"][data-active="true"]`).count(), 0);
    assert.equal(await page.locator('#reading path[d*="NaN"], #map path[d*="NaN"]').count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);

    await mount(versions + [
      '', '- [_ @before, @after ~> @change; @existing]',
      '- [_ @after, @missing ~> @change; @failed] Keep this failed prose.',
      '- [_ @before, @after concerns @failed; @dependent]',
    ].join('\n'));
    assert.equal(await page.locator('#reading .cog-reading-relation').count(), 1, 'a failed joint and its dependent have no rendered relation');
    assert.match(await row(5).textContent(), /Keep this failed prose/);
    assert.equal(await row(5).locator('.cog-reading-diagnostic').count(), 1);
    assert.equal(await page.locator('#map [data-node^="bearing:"]').count(), 1);
    assert.equal(await page.locator('#map .cog-link').count(), 3, 'only the complete surviving joint is drawn');

    for (const [clause, parent, kind] of [['+> ^', 'C', 'supports'], ['-> ^', 'C', 'challenges'], ['respondsTo ^', 'O', 'respondsTo'], ['clarifies ^', 'C', 'clarifies']]) {
      await mount(`- [${parent} @target] Target.
  - [_ ${clause}; @joint] Route description.
    - [. @a] First source.
    - [. @b] Second source.
    - [_ note] Detail about this route.`);
      assert.deepEqual(await page.evaluate(() => window.views.projection.diagnostics), []);
      assert.equal(await row(2).locator('.cog-reading-relation').getAttribute('data-kind'), kind);
      assert.deepEqual(await row(2).locator('.cog-reading-endpoints button').allTextContents(), ['@a', '@b', '@target']);
      assert.equal(await row(3).locator('.cog-reading-relation').count(), 0, 'a neutral member creates no unary attachment');
      assert.equal(await row(4).locator('.cog-reading-relation').count(), 0);
      const junction = page.locator('#map [data-node="bearing:_b1"]');
      assert.match(await junction.getAttribute('aria-label'), /joint, 2 sources/);
      assert.equal(await page.locator('#map .cog-link').count(), 3);
      await row(2).locator('.cog-reading-relation [data-ref-kind="bearing"]').click();
      assert.equal(await row(2).getAttribute('data-selected-reference'), 'bearing', 'the role header selects a Bearing, not a new Point');
      assert.equal(await row(5).getAttribute('data-related'), 'true', 'the route note follows its owner');
    }

    for (const [clause, kind] of [['+> ^/', 'supports'], ['-> ^/', 'challenges'], ['~> ^/', 'concerns'], ['clarifies ^/', 'clarifies']]) {
      await mount(`- [C @claim] Claim.
  - [_ +> ^; @step]
    - [. @source] Original source.
    - [_ ${clause}; @review] Joint review.
      - [. @a] First review source.
      - [. @b] Second review source.
      - [_ note] Review note.`);
      assert.deepEqual(await page.evaluate(() => window.views.projection.diagnostics), []);
      assert.equal(await row(4).locator('.cog-reading-relation').getAttribute('data-kind'), kind);
      assert.deepEqual(await row(4).locator('.cog-reading-endpoints button').allTextContents(), ['@a', '@b', '@step']);
      assert.equal(await row(5).locator('.cog-reading-relation').count(), 0);
      assert.equal(await row(6).locator('.cog-reading-relation').count(), 0);
      assert.equal(await page.locator('#map .cog-link').count(), 5);
      assert.match(await page.locator('#map [data-node="bearing:_b2"]').getAttribute('aria-label'), /joint, 2 sources/);
      await row(4).locator('.cog-reading-endpoints').getByRole('button', { name: 'Bearing @step, line 2', exact: true }).click();
      assert.equal(await row(2).getAttribute('data-selected-reference'), 'bearing');
      await page.locator('#map [data-node="bearing:_b2"]').dispatchEvent('click');
      assert.equal(await page.locator('#map [data-node="bearing:_b2"]').getAttribute('aria-pressed'), 'true');
      await row(4).getByRole('button', { name: 'Bearing @review, line 4', exact: true }).click();
      await flush();
      assert.equal(await row(7).getAttribute('data-related'), 'true', 'the review note belongs to the joint assessment');
    }

    await mount(`- [C @claim] The visitor may be familiar.
  - [_ +> ^; @step]
    - [.] The dog did not bark.
    - [Q/ @conditions; @inquiry] When does silence support familiarity?
      - [R] Check whether the dog was awake.`);
    assert.deepEqual(await page.evaluate(() => window.views.projection.diagnostics), []);
    assert.equal(await row(4).getAttribute('data-role'), 'Q');
    assert.equal(await row(4).locator('.cog-reading-mark .cog-glyph-letter').textContent(), 'Q');
    assert.equal(await row(4).locator('.cog-reading-relation').getAttribute('data-kind'), 'concerns');
    assert.equal(await row(5).locator('.cog-reading-relation').getAttribute('data-kind'), 'respondsTo');
    assert.equal(await row(3).locator('.cog-reading-relation').count(), 0, 'the source member owns no unary attachment');
    await row(4).locator('.cog-reading-endpoints').getByRole('button', { name: 'Bearing @step, line 2', exact: true }).click();
    assert.equal(await row(2).getAttribute('data-selected-reference'), 'bearing', 'Q/ concerns the step rather than its source Point');
    await row(5).locator('.cog-reading-endpoints').getByRole('button', { name: 'Point @conditions, line 4', exact: true }).click();
    assert.equal(await row(4).getAttribute('data-selected-reference'), 'point', 'R replies to the Question rather than its concerns Bearing');
    const questionKeys = await page.evaluate(() => {
      const { graph } = window.views.projection.units[0];
      return {
        point: graph.points.find(point => point.id === 'conditions').key,
        inquiry: graph.bearings.find(bearing => bearing.handle === 'inquiry').key,
      };
    });
    assert.match(await page.locator(`#map [data-node="point:${questionKeys.point}"]`).getAttribute('aria-label'), /Question/);
    const questionBearing = page.locator(`#map g[data-node="bearing:${questionKeys.inquiry}"]`);
    assert.match(await questionBearing.getAttribute('aria-label'), /concerns/);
    assert.equal(await questionBearing.locator('.cog-bearing-glyph.cog-tone-neutral').count(), 1);
    assert.equal(await page.locator(`#map [data-bearing="${questionKeys.inquiry}"].cog-link.cog-tone-neutral.cog-dashed`).count(), 1, 'an unaddressed unary concern keeps the existing inline presentation');
    assert.equal(await page.locator('#reading path[d*="NaN"], #map path[d*="NaN"]').count(), 0);
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

    // Alternative routes: the selected route keeps the emphasis while the pointer crosses other passages.
    await mount(alternativeRoutes);
    const opacity = locator => locator.evaluate(node => Number(getComputedStyle(node).opacity));
    const related = async () => Object.fromEntries(await Promise.all([1, 2, 3, 4, 5, 6].map(async line => [line, await row(line).getAttribute('data-related')])));
    const readingArc = key => page.locator(`#reading g[data-bearing="${key}"]`);
    await row(3).locator('.cog-reading-relation [data-ref-kind="bearing"]').click();
    const proximityFocus = { 1: 'true', 2: 'true', 3: 'true', 4: 'true', 5: 'false', 6: 'false' };
    assert.deepEqual(await related(), proximityFocus, 'the original route keeps its source, target and step objection');
    await row(5).hover(); await flush();
    assert.deepEqual(await related(), proximityFocus, 'hovering another passage does not move the selected route');
    assert.equal(await row(3).getAttribute('data-selected'), 'true');
    assert.equal(await readingArc('_b3').getAttribute('data-active'), 'false', 'the alternative route stays de-emphasized');
    assert.equal(await readingArc('_b2').getAttribute('data-active'), 'true', 'the objection stays with the route it addresses');
    assert.ok(await opacity(row(5)) > .5 && await opacity(row(6)) < .5, 'a pointed passage stays readable without being guided');
    assert.ok(await opacity(readingArc('_b3')) > 0, 'the alternative route remains visible');
    await row(3).focus(); await page.keyboard.press('Escape'); await row(6).hover(); await flush();
    assert.deepEqual(await related(), { 1: 'true', 2: 'true', 3: 'false', 4: 'false', 5: 'true', 6: 'true' }, 'without a selection, hover previews the other route');
    assert.equal(await readingArc('_b2').getAttribute('data-active'), 'false', 'an objection to proximity is not drawn against the water route');
    await page.mouse.move(0, 0);

    const node = id => page.locator(`#map g[data-node="${id}"]`);
    const mapRelated = () => page.locator('#map g[data-node]').evaluateAll(nodes => Object.fromEntries(nodes.map(n => [n.dataset.node, n.dataset.related])));
    await node('bearing:_b1').click(); await flush();
    const mapProximity = await mapRelated();
    assert.deepEqual(mapProximity, { 'bearing:_b2': 'true', 'point:_p1': 'true', 'point:_p2': 'true', 'point:_p3': 'true', 'point:_p4': 'false', 'bearing:_b1': 'true', 'bearing:_b3': 'false' });
    await node('bearing:_b3').hover(); await flush();
    assert.deepEqual(await mapRelated(), mapProximity, 'hovering the alternative junction does not move the selected route');
    assert.ok(await opacity(node('bearing:_b3')) > .5, 'a pointed alternative stays readable and selectable');
    assert.deepEqual(await page.locator('#map path.cog-link[data-active="true"]').evaluateAll(paths => [...new Set(paths.map(p => p.dataset.bearing))].sort()), ['_b1', '_b2']);
    await node('bearing:_b3').dispatchEvent('click', { detail: 0 });
    assert.equal(await node('bearing:_b3').getAttribute('aria-pressed'), 'true', 'assistive activation moves the inspected route');
    assert.deepEqual(await page.locator('#map path.cog-link[data-active="true"]').evaluateAll(paths => [...new Set(paths.map(p => p.dataset.bearing))]), ['_b3']);
    await node('bearing:_b3').focus(); await page.keyboard.press('Escape'); await page.mouse.move(0, 0); await flush();
    assert.equal(await page.locator('#map svg').getAttribute('data-guided'), 'false', 'clearing restores the unguided Map');

    // Route identity is the Bearing, not its kind and endpoints.
    await mount('- [C @c] Claim.\n- [G @a] Reason.\n- [edge @a +> @c; @first] One reading.\n- [edge @a +> @c; @second] Another reading.\n- [O -> @second] Doubt.');
    await node('bearing:_b2').click(); await page.mouse.move(0, 0); await flush();
    assert.deepEqual(await page.locator('#map path.cog-link[data-active="true"]').evaluateAll(paths => [...new Set(paths.map(p => p.dataset.bearing))].sort()), ['_b2', '_b3']);
    assert.equal(await node('bearing:_b1').getAttribute('data-related'), 'false', 'a parallel Bearing of the same kind stays a separate route');

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
    await mount([
      '- [C @c] Claim.', '  - [G @g; @step] Ground.', '    - Context.', '      - [O] Through body.',
      '    - [_ -> ^/; @r] Together.', '      - [. @x] X.', '      - [. @y] Y.', '- [C] Other.', '  - [_ +> ^/]', '    - [.] Fails.',
    ].join('\n'));
    await row(4).locator('.cog-reading-select').click(); await flush();
    const inspection = row(4).locator('.cog-reading-inspection');
    assert.equal(await inspection.locator('.cog-chip').count(), 1, 'the relation glyph leads the inspection');
    assert.match(await inspection.locator('span').last().textContent(), /^From indentation: challenges @g \(L2\), the nearest enclosing Point\. It passes through ordinary body at L3\./);
    assert.equal(await row(4).getAttribute('aria-describedby'), await inspection.getAttribute('id'), 'the inspection line describes its row');
    const rail = page.locator('#reading .cog-reading-commitment');
    assert.equal(await rail.getAttribute('data-basis'), 'indentation');
    assert.equal(await rail.locator('.cog-reading-commitment-crossed').count(), 1, 'the crossed body row is marked on the rail');
    const railBox = await rail.locator('.cog-reading-commitment-rail').boundingBox();
    const [contextBox, subjectBox] = [await row(2).boundingBox(), await row(4).boundingBox()];
    assert.ok(railBox.y >= contextBox.y && railBox.y + railBox.height <= subjectBox.y + subjectBox.height, 'the rail spans from the selected context to the row');
    await row(6).locator('.cog-reading-select').click(); await flush();
    assert.equal(await page.locator('#reading .cog-reading-inspection').count(), 1, 'only the selected row is described');
    assert.equal(await row(6).locator('.cog-reading-inspection-glyph').textContent(), '◇', 'a joint source leads with the junction glyph');
    assert.match(await row(6).locator('.cog-reading-inspection > span').last().textContent(), /^Source of the constructor at L5/);
    assert.equal(await rail.locator('.cog-reading-commitment-member').count(), 1, 'a member shows its header bracket with itself marked');
    await row(9).locator('.cog-reading-select').click(); await flush();
    assert.equal(await rail.getAttribute('data-basis'), 'failed');
    assert.match(await row(9).locator('.cog-reading-inspection').textContent(), /\[_ \+> \^\]/, 'a failed row repeats its remedy');
    await page.keyboard.press('Escape'); await flush();
    assert.equal(await page.locator('#reading .cog-reading-inspection').count(), 0);
    await page.evaluate(() => { window.views.reading.destroy(); window.views.map.destroy(); });
    assert.equal(await page.locator('.cog-reading, .cog-graph').count(), 0);
    await page.close(); runs++;
  }

  // A tap selects a route and leaves no sticky hover that later outranks it.
  const touch = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, reducedMotion: 'reduce' });
  const page = await touch.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.setContent('<div id="reading"></div><div id="map" style="height:500px"></div>');
  await page.addStyleTag({ path: fileURLToPath(new URL('../src/style.css', import.meta.url)) });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.evaluate(source => window.mount(source), alternativeRoutes);
  await page.locator('#map g[data-node="bearing:_b3"]').tap();
  await page.locator('#map g[data-node="point:_p3"]').tap();
  assert.equal(await page.locator('#map g[data-node="point:_p3"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('#map g[data-node="bearing:_b1"]').getAttribute('data-related'), 'true', 'a tapped objection includes the route it addresses');
  assert.equal(await page.locator('#map g[data-node="bearing:_b3"]').getAttribute('data-related'), 'false', 'the previously tapped route does not linger as hover');
  await page.locator('#map svg').tap({ position: { x: 4, y: 4 } });
  assert.equal(await page.locator('#map svg').getAttribute('data-guided'), 'false', 'tapping the background clears the focus');
  await touch.close();
  assert.deepEqual(errors, []);
  console.log(`View selection browser checks passed: ${runs} viewports and touch; occurrence echoes, keyboard refs, Map Fit and focus reveal, host typography, assistive clicks, selected-route guidance, local question/reply targets, commitment rails and inspection, partial compilation, cycles, duplicate Bearings, unit scope and cleanup.`);
} finally {
  await browser.close();
}
