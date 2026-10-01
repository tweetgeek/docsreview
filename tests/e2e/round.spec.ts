import fs from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const ROOT = path.resolve('tests/e2e/.work/round/root');
const FIRST_OUTPUT = '### docs/guide.md:3 > podaj komendę npx\n\n### docs/guide.md:6 > rozwiń ten krok';

test.use({ baseURL: 'http://127.0.0.1:4601' });

test('a full review round', async ({ page }) => {
  await page.goto('/?token=e2e');
  await expect(page.locator('.file-path')).toHaveText('docs/guide.md');

  const raw = page.locator('[data-pane="raw"]');
  const render = page.locator('[data-pane="render"]');

  await test.step('comment on a line in the raw pane', async () => {
    await raw.locator('.raw-line').nth(2).hover();
    await raw.getByRole('button', { name: 'Dodaj komentarz: 3', exact: true }).click();
    await page.getByPlaceholder('Treść komentarza').fill('podaj komendę npx');
    await page.keyboard.press('ControlOrMeta+Enter');
    await expect(raw.locator('.comment')).toHaveCount(1);
    await expect(render.locator('.comment')).toHaveCount(1);
  });

  await test.step('comment on a block in the render pane', async () => {
    await render.locator('li', { hasText: 'krok drugi' }).hover();
    await render.getByRole('button', { name: 'Dodaj komentarz: 6', exact: true }).click();
    await page.getByPlaceholder('Treść komentarza').fill('rozwiń ten krok');
    await page.getByRole('button', { name: 'Zapisz' }).click();
    await expect(raw.locator('.comment')).toHaveCount(2);
    await expect(render.locator('.comment')).toHaveCount(2);
  });

  const output = page.getByRole('textbox', { name: 'Output' });
  const copy = page.locator('.output').getByRole('button', { name: 'Kopiuj' });

  await test.step('copy the output, which starts a round', async () => {
    await page.getByRole('button', { name: 'Komentarze (2)' }).click();
    await expect(output).toHaveValue(FIRST_OUTPUT);
    await copy.click();
    await expect(page.getByRole('status')).toHaveText('Skopiowano. Zaczęła się nowa runda.');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(FIRST_OUTPUT);
    await expect(page.locator('.badge.handed-off')).toHaveCount(2);
  });

  await test.step('the agent changes one file and adds another', async () => {
    await fs.writeFile(
      path.join(ROOT, 'docs/guide.md'),
      ['# Przewodnik', '', 'Uruchom `npx docsreview`.', '', '- krok pierwszy', '- krok drugi', ''].join('\n'),
    );
    await fs.writeFile(path.join(ROOT, 'docs/new.md'), '# Nowy\n');
    await expect(page.locator('.needs-check-group .comment-row')).toHaveCount(1);
    await expect(page.locator('.needs-check-group')).toContainText('linia zmieniona');
  });

  await test.step('copying again asks about comments that need a check', async () => {
    await copy.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('1 komentarz z poprzedniej rundy ma zmienioną linię. Skopiować mimo to?');
    await dialog.getByRole('button', { name: 'Pokaż je' }).click();
    await expect(dialog).toHaveCount(0);
  });

  await test.step('the files view shows what changed in this round', async () => {
    await page.locator('.needs-check-group .comment-row-main').click();
    await expect(page.locator('.tree-file', { hasText: 'guide.md' }).locator('.badge')).toHaveText('zmieniony');
    await expect(page.locator('.tree-file', { hasText: 'new.md' }).locator('.badge')).toHaveText('nowy');
    await expect(raw.locator('.raw-line.changed')).toHaveCount(1);
    await expect(render.locator('p.changed')).toHaveText('Uruchom npx docsreview.');
    const card = raw.locator('.comment.needs-check');
    await expect(card).toContainText('było: Uruchom `npm start`.');
    await card.getByRole('button', { name: 'Rozwiąż' }).click();
    await expect(raw.locator('.comment')).toHaveCount(1);
  });

  await test.step('the resolved comment is gone from the output', async () => {
    await page.getByRole('button', { name: 'Komentarze (1)' }).click();
    await expect(output).toHaveValue('### docs/guide.md:6 > rozwiń ten krok');
  });
});

test('the working directory can be changed and restored from the recent list', async ({ page }) => {
  await page.goto('/?token=e2e');
  await page.getByRole('button', { name: 'Zmień katalog' }).click();
  const dialog = page.getByRole('dialog', { name: 'Zmień katalog roboczy' });

  await dialog.getByRole('button', { name: 'docs/', exact: true }).click();
  await expect(dialog.locator('.dir-current')).toHaveText(path.join(ROOT, 'docs'));
  await dialog.getByRole('button', { name: 'Wybierz ten katalog' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.root')).toHaveText(path.join(ROOT, 'docs'));
  await expect(page.locator('.file-path')).toHaveText('guide.md');
  await expect(page.getByRole('button', { name: 'Komentarze (0)' })).toBeVisible();

  await page.getByRole('button', { name: 'Zmień katalog' }).click();
  await dialog.getByRole('button', { name: ROOT, exact: true }).click();
  await expect(page.locator('.root')).toHaveText(ROOT);
  await expect(page.locator('.file-path')).toHaveText('docs/guide.md');
});
