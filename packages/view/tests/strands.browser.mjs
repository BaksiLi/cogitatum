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
      import { createBlockView } from '@cogitatum/view/block';
      window.mount = source => {
        window.block?.destroy();
        window.edits = [];
        window.block = createBlockView(document.querySelector('#host'), { onEdit: request => { window.edits.push(request.sourceSpan); } });
        window.block.update(source);
      };
    `,
    resolveDir: fileURLToPath(new URL('../src/', import.meta.url)),
  },
  bundle: true, write: false, format: 'iife', platform: 'browser', conditions: ['development'],
});
const source = [
  '- [C @water] The pump was the source.',
  '  - [G @cluster; @proximity] Deaths clustered around the pump.',
  '    - [O/ @exceptions] The workhouse had almost no cases.',
  '      - [R] It had its own well.',
  '  - [G @exposure; @route] Distant victims drank pump water.',
  '    - [_ G]',
  '      - [. @widow] A widow had pump water delivered.',
  '      - [. @niece] Her niece also died.',
  '    - [G use @cluster] The cluster fits exposure.',
  '  - [O @miasma] Miasma explains it better.',
  '- [C @parish] The parish should close the well.',
  '  - [G use @water] The pump is the source.',
].join('\n');
const browser = await chromium.launch();
const errors = [];
let runs = 0;
try {
  for (const width of [1280, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    page.setDefaultTimeout(3000);
    page.on('pageerror', error => errors.push(`${width}px: ${error.message}`));
    await page.setContent('<div id="host" style="width:min(720px,100%)"></div>');
    await page.addStyleTag({ path: fileURLToPath(new URL('../src/style.css', import.meta.url)) });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const flush = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.evaluate(source => window.mount(source), source);
    await page.getByRole('button', { name: 'Strands' }).click(); await flush();
    const strands = page.locator('.cog-strands');
    assert.equal(await page.locator('.cog-block').getAttribute('data-mode'), 'strands');
    const endings = await page.locator('.cog-strands-root').evaluateAll(chips => chips.map(chip => chip.lastChild.textContent));
    assert.deepEqual(endings, ['@parish'], 'only the Point bearing on nothing is offered as an ending');
    const names = await page.locator('.cog-strands-row-point .cog-strands-point-line > .cog-strands-name').allTextContents();
    assert.deepEqual(names.slice(0, 2), ['@parish', '@water']);
    assert.equal(names.filter(name => name === '@cluster').length, 1, 'a shared Point appears once');
    assert.ok(await page.locator('.cog-strands-lanes .cog-strands-lane').count() > 5, 'lanes are drawn');
    assert.equal(await page.locator('.cog-strands-junction').count(), 1, 'the joint step meets at one junction');
    const knot = page.locator('.cog-strands-row-knot');
    assert.equal(await knot.count(), 1);
    assert.match(await knot.textContent(), /challenges the step @proximity/);
    // The contested step's knot sits directly above its source.
    assert.equal(await knot.evaluate(node => node.nextElementSibling.querySelector('.cog-strands-name').textContent), '@cluster');

    await knot.locator('.cog-strands-knot-head').first().click(); await flush();
    assert.equal(await strands.getAttribute('data-contest'), 'true', 'a challenge enters Challenge Focus');
    const lit = await page.locator('.cog-strands-row[data-lit="true"] .cog-strands-point-line > .cog-strands-name').allTextContents();
    assert.deepEqual(lit, ['@parish', '@water', '@cluster']);
    assert.ok(await page.locator('.cog-strands-segment > [data-lit="false"]').count() > 0, 'lanes off the contest dim');
    await page.keyboard.press('Escape'); await flush();
    assert.equal(await strands.getAttribute('data-contest'), 'false');

    await page.locator('.cog-strands-row-point', { hasText: 'Her niece also died.' }).click(); await flush();
    await page.getByRole('button', { name: 'Reading' }).click(); await flush();
    assert.match(await page.locator('.cog-reading-row[data-selected="true"]').textContent(), /Her niece also died/, 'Strands selection reaches Reading');
    await page.locator('.cog-reading-row', { hasText: 'Miasma explains' }).locator('.cog-reading-select').click();
    await page.getByRole('button', { name: 'Strands' }).click(); await flush();
    assert.equal(await page.locator('.cog-strands-row[data-selected="true"]').count(), 1, 'Reading selection reaches Strands');
    await page.locator('.cog-strands-row-point', { hasText: 'Deaths clustered' }).dblclick();
    assert.equal((await page.evaluate(() => window.edits))[0].startLine, 2, 'double-click opens the selected passage');

    const response = page.locator('.cog-strands-relation');
    assert.match(await response.locator('.cog-strands-knot-head').textContent(), /responds to @exceptions/, 'each relation names its actual target');
    await response.locator('.cog-strands-relation-source').click(); await flush();
    assert.equal(await page.locator('.cog-reading-row[data-selected="true"]').getAttribute('data-line'), '4');
    assert.equal(await page.locator('.cog-reading-row[data-selected="true"]').getAttribute('data-selected-reference'), 'point', 'Point wording selects the Point inside a knot');
    await response.locator('.cog-strands-knot-head').click(); await flush();
    assert.equal(await page.locator('.cog-reading-row[data-selected="true"]').getAttribute('data-selected-reference'), 'bearing');
    assert.equal(await page.locator('.cog-strands-row[data-selected="true"]').count(), 1, 'a nested relation has a selection location');

    await knot.locator('.cog-strands-knot-head').first().click();
    await page.getByRole('button', { name: 'Map', exact: true }).click(); await flush();
    await page.locator('.cog-graph').click({ position: { x: 2, y: 2 } });
    await page.getByRole('button', { name: 'Strands', exact: true }).click(); await flush();
    assert.equal(await page.locator('.cog-strands-row[data-selected="true"]').count(), 0, 'Map clearing reaches Strands');
    assert.equal(await strands.getAttribute('data-contest'), 'false', 'Map clearing also leaves Challenge Focus');

    const separate = [
      '- [C @first] First ending.', '  - [G @a; @one] First ground.',
      '- [C @second] Second ending.', '  - [G @b; @two] Second ground.',
    ].join('\n');
    await page.evaluate(source => window.mount(source), separate);
    await page.getByRole('button', { name: 'Strands', exact: true }).click();
    assert.match(await page.locator('.cog-strands-root[aria-pressed="true"]').textContent(), /@first/);
    await page.getByRole('button', { name: 'Reading', exact: true }).click();
    const other = page.locator('.cog-reading-row[data-line="4"]');
    await other.focus(); await page.keyboard.press('Space'); await page.keyboard.press('ArrowRight');
    assert.equal(await other.getAttribute('data-selected-reference'), 'bearing');
    await page.getByRole('button', { name: 'Strands', exact: true }).click(); await flush();
    assert.match(await page.locator('.cog-strands-root[aria-pressed="true"]').textContent(), /@second/, 'selecting an unseen Bearing follows its target to the other ending');
    assert.equal(await page.locator('.cog-strands-row[data-selected="true"]').count(), 1, 'an undescribed strand step is still selectable');
    await page.locator('.cog-strands-via-step').click();
    assert.equal(await other.getAttribute('data-selected-reference'), 'bearing', 'a strand relation has its own pointer target');

    await page.evaluate(source => window.mount(source), '- [C @c] Claim.\n  - [O @o] Objection.');
    await page.getByRole('button', { name: 'Strands', exact: true }).click();
    const focusRow = page.locator('.cog-strands-row').first();
    await focusRow.focus(); await page.keyboard.press('Space'); await page.keyboard.press('ArrowRight');
    assert.equal(await page.locator('.cog-strands').getAttribute('data-contest'), 'true', 'keyboard selection can reach a challenge attached to a Point');
    assert.equal(await page.locator('.cog-reading-row[data-line="2"]').getAttribute('data-selected-reference'), 'bearing');
    await page.keyboard.press('Enter');
    assert.equal((await page.evaluate(() => window.edits))[0].startLine, 2, 'Enter opens the selected Bearing rather than the row Point');

    await page.evaluate(source => window.mount(source), '- [C @a] A.\n  - [G @b] B.\n    - [G use @a]');
    await page.getByRole('button', { name: 'Strands', exact: true }).click(); await flush();
    assert.equal(await page.locator('.cog-strands-row-point').count(), 2, 'a closed cycle has Points to follow without an explicit focus');
    assert.equal(await page.locator('.cog-strands-label').textContent(), 'Strands focused at');
    assert.match(await page.locator('.cog-strands-cycle').textContent(), /closing a cycle/);

    const sharedRoutes = [
      '- [C @water] The pump was the source.', '  - [G @cluster; @proximity] Nearby cases.',
      '    - [O/ @exceptions] Nearby exceptions.', '  - [_ G; @route] Actual exposure.',
      '    - [. use @cluster]', '    - [. @exposure] Distant drinkers.',
      '    - [O/ @alternative] A separate objection to exposure.',
    ].join('\n');
    await page.evaluate(source => window.mount(source), sharedRoutes);
    await page.getByRole('button', { name: 'Strands', exact: true }).click(); await flush();
    const direct = page.locator('.cog-strands-row-knot').filter({ hasText: 'challenges the step @proximity' });
    const alternative = page.locator('.cog-strands-row-knot').filter({ hasText: 'challenges the step @route' });
    await direct.locator('.cog-strands-knot-head').first().click(); await flush();
    assert.equal(await direct.getAttribute('data-lit'), 'true');
    assert.equal(await alternative.getAttribute('data-lit'), 'false', 'sharing a Ground does not put the alternative route under the same objection');
    const alternativeKey = await page.locator('.cog-strands-via-step').filter({ hasText: '@route' }).first().getAttribute('data-bearing');
    assert.ok(await page.locator(`.cog-strands-segment > [data-bearing="${alternativeKey}"][data-lit="false"]`).count() > 0, 'the alternative Bearing dims even when its source and target are lit');
    await page.screenshot({ path: `/private/tmp/cogitatum-strands-review-${width}.png`, fullPage: true });
    await page.getByRole('button', { name: 'Show all', exact: true }).click(); await flush();
    assert.equal(await page.locator('.cog-strands').getAttribute('data-contest'), 'false', 'a pointer or touch user can leave focus without a keyboard');
    assert.equal(await page.getByRole('button', { name: 'Show all', exact: true }).count(), 0, 'the exit control appears only when needed');

    const reused = '- [C @shared] Shared wording.\n- [C @claim] Claim.\n  - [G use @shared] Used here.';
    await page.evaluate(source => window.mount(source), reused);
    const use = page.locator('.cog-reading-row[data-line="3"]');
    await use.focus(); await page.keyboard.press('Space');
    await page.getByRole('button', { name: 'Strands', exact: true }).click();
    await page.locator('.cog-strands-point-line').filter({ hasText: 'Shared wording.' }).click();
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    assert.equal((await page.evaluate(() => window.edits))[0].startLine, 3, 'reselecting a shared Point retains the chosen local occurrence');
    await page.getByRole('button', { name: 'Reading', exact: true }).click();
    assert.equal(await use.getAttribute('data-selected'), 'true');

    const unseen = '- [C @first] First.\n  - [G] One.\n- [C @second] Second.\n  - [G; @step] Two.\n    - [O/ @o] An exception.\n      - [R @r] A response.';
    await page.evaluate(source => window.mount(source), unseen);
    await page.getByRole('button', { name: 'Strands', exact: true }).click();
    await page.getByRole('button', { name: 'Reading', exact: true }).click();
    await page.locator('.cog-reading-row[data-line="5"]').locator('.cog-reading-select').click();
    await page.getByRole('button', { name: 'Strands', exact: true }).click(); await flush();
    assert.match(await page.locator('.cog-strands-root[aria-pressed="true"]').textContent(), /@second/, 'an unseen objection keeps the route it challenges in context');
    assert.match(await page.locator('.cog-strands-row[data-selected="true"]').textContent(), /An exception/);
    await page.getByRole('button', { name: 'Reading', exact: true }).click();
    await page.locator('.cog-reading-row[data-line="6"]').locator('.cog-reading-select').click();
    await page.getByRole('button', { name: 'Strands', exact: true }).click();
    assert.match(await page.locator('.cog-strands-root[aria-pressed="true"]').textContent(), /@second/, 'the same holds for a response inside the knot');

    // Host-rendered controls have the same boundary in Reading and Strands.
    const responseText = page.locator('.cog-strands-relation-source .cog-strands-text');
    await responseText.evaluate(node => { node.innerHTML = '<details><summary>Host disclosure</summary><button role="button">Host action</button></details>'; });
    await responseText.locator('summary').click();
    await responseText.locator('button').focus();
    await page.keyboard.press('Enter');
    assert.equal((await page.evaluate(() => window.edits)).length, 0, 'native prose controls do not open source or select a different object');

    const many = ['- [C @claim] Many sources.', '  - [_ G]', ...Array.from({ length: 32 }, (_, i) => `    - [.] Source ${i + 1}.`)].join('\n');
    await page.evaluate(source => window.mount(source), many);
    await page.getByRole('button', { name: 'Strands', exact: true }).click(); await flush();
    assert.equal(await page.locator('.cog-strands-row-point').count(), 33);
    assert.ok(await page.locator('.cog-strands').evaluate(node => node.scrollWidth <= node.clientWidth + 1), 'dense lanes leave room for prose within the host');
    assert.ok(await page.locator('.cog-strands-point-line').last().evaluate(node => node.clientWidth > 150), 'the narrow reader retains a usable text column');

    const anonymous = '- [C] First.\n  - [G] One.\n- [C] Second.\n  - [G] Two.';
    await page.evaluate(source => window.mount(source), anonymous);
    await page.getByRole('button', { name: 'Strands', exact: true }).click();
    await page.locator('.cog-strands-root').last().click();
    await page.evaluate(source => window.block.update('- [C] Preface.\n' + source), anonymous); await flush();
    assert.match(await page.locator('.cog-strands-point-line').first().textContent(), /First\./, 'a reused anonymous compilation key cannot retain a different focus after editing');

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 0, `no horizontal page scroll at ${width}px`);
    await page.evaluate(() => window.block.destroy());
    assert.equal(await page.locator('.cog-strands').count(), 0);
    await page.close(); runs++;
  }
  assert.deepEqual(errors, []);
  console.log(`Strands browser checks passed: ${runs} viewports; endings, lanes, merges, joints, step knots, Challenge Focus, shared selection, source navigation and cleanup.`);
} finally {
  await browser.close();
}
