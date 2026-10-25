import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const { build } = require('esbuild');
const bundle = await build({
  stdin: {
    contents: `
      import { explainSource } from '@cogitatum/core';
      import { projectReading, referenceKey } from '@cogitatum/view';
      import { createBlockView } from '@cogitatum/view/block';
      window.mount = source => {
        window.block?.destroy();
        window.requests = [];
        window.projection = projectReading(source, explainSource(source));
        window.block = createBlockView(document.querySelector('#host'), {
          onEdit: request => { window.requests.push(request); }
        });
        window.block.update(source);
      };
      window.refAt = (line, kind) => referenceKey(window.projection.units[0].occurrences
        .find(row => row.line === line).references.find(reference => reference.ref.kind === kind).ref);
    `,
    resolveDir: fileURLToPath(new URL('../src/', import.meta.url)),
  },
  bundle: true, write: false, format: 'iife', platform: 'browser', conditions: ['development'],
});
const sourceFor = indent => [
  '- [C @p] The method may work',
  '  only under the stated conditions.',
  '- [C @q] Check the method.',
  `${indent}- [G use @p; @r] This local use`,
  `${indent}  has a second line.`,
  `${indent.repeat(2)}- [_ note] A route explanation`,
  `${indent.repeat(2)}  with another line.`,
  '',
  `${indent.repeat(2)}  And another paragraph.`,
  `${indent.repeat(3)}- [O @hidden] Literal syntax`,
  `${indent.repeat(3)}  remains literal.`,
  `${indent.repeat(2)}- [O/] Check the conditions.`
].join('\n');
const browser = await chromium.launch();
const errors = [];
let checks = 0;
try {
  for (const width of [1280, 390]) for (const indent of ['  ', '\t']) {
    const source = sourceFor(indent);
    const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    page.setDefaultTimeout(3000);
    page.on('pageerror', error => errors.push(`${width}px: ${error.message}`));
    await page.setContent('<div id="host" style="width:min(720px,100%);"></div>');
    await page.addStyleTag({ path: fileURLToPath(new URL('../src/style.css', import.meta.url)) });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(source => window.mount(source), source);
    const root = page.locator('.cog-block');
    const row = line => root.locator(`[data-occurrence][data-line="${line}"]`);
    const button = name => root.getByRole('button', { name, exact: true });

    assert.equal(await row(1).locator('.cog-reading-text').textContent(), 'The method may work\nonly under the stated conditions.');
    assert.equal(await row(4).locator('.cog-reading-text').textContent(), 'This local use\nhas a second line.');
    assert.equal(await row(4).locator('.cog-reading-shared-text').textContent(), 'The method may work\nonly under the stated conditions.');
    assert.equal(await row(6).locator('.cog-reading-text').textContent(), 'A route explanation\nwith another line.\n\nAnd another paragraph.');
    assert.equal(await row(10).locator('.cog-reading-text').textContent(), '[O @hidden] Literal syntax\nremains literal.');
    for (const line of [2, 5, 7, 8, 9, 11]) assert.equal(await root.locator(`.cog-reading-row[data-line="${line}"]`).count(), 0);
    assert.equal(await page.evaluate(() => window.projection.units[0].graph.points.length), 3);
    assert.equal(await page.evaluate(() => window.projection.units[0].graph.bearings.length), 2);
    checks++;

    await row(6).focus();
    await page.keyboard.press('Enter');
    assert.equal(await row(6).getAttribute('data-related'), 'true');
    assert.equal(await row(10).getAttribute('data-related'), 'true', 'a selected note keeps its complete literal subtree in focus');
    assert.equal(await row(1).getAttribute('data-related'), 'false', 'note focus does not import the source Point declaration');
    assert.deepEqual(await page.evaluate(() => window.requests[0].sourceSpan), {
      startLine: 6, startColumn: indent.length * 2 + 3, endLine: 9, endColumn: source.split('\n')[8].length + 1
    });
    await button('Map').click();
    const ref = await page.evaluate(() => window.refAt(4, 'bearing'));
    const mark = root.locator(`.cog-node[data-node="${ref}"]`);
    await mark.dispatchEvent('click', { detail: 0 });
    const details = root.locator('.cog-block-detail-text');
    assert.match(await details.textContent(), /A route explanation\nwith another line\.\n\nAnd another paragraph\./);
    assert.match(await details.textContent(), /\[O @hidden\] Literal syntax\nremains literal\./);
    await details.getByRole('button', { name: 'Note · line 6', exact: true }).click();
    assert.equal(await row(6).getAttribute('data-selected'), 'true');
    assert.equal(await row(10).getAttribute('data-related'), 'true', 'Map note navigation retains the same complete annotation focus');
    await button('Edit').click();
    assert.deepEqual(await page.evaluate(() => window.requests.at(-1).sourceSpan), {
      startLine: 6, startColumn: indent.length * 2 + 3, endLine: 9, endColumn: source.split('\n')[8].length + 1
    });
    checks++;

    const invalid = '- [C] Claim.\n  - [_ note\n    ] cannot repair the header.\n    - [G @hidden] Literal.';
    await page.evaluate(source => window.mount(source), invalid);
    assert.equal(await row(2).locator('.cog-reading-text').textContent(), '[_ note\n    ] cannot repair the header.');
    assert.equal(await page.evaluate(() => window.projection.units[0].graph.points.length), 1);
    assert.equal(await root.locator('.cog-reading-row[data-line="3"]').count(), 0);
    checks++;
    await page.evaluate(() => window.block.destroy());
    await page.close();
  }
  assert.deepEqual(errors, []);
  console.log(`Multiline browser checks passed: ${checks} (desktop and mobile, spaces and tabs).`);
} finally {
  await browser.close();
}
