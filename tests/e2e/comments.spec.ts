import fs from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const ROOT = path.resolve('tests/e2e/.work/comments/root');
const GUIDE = path.join(ROOT, 'docs/guide.md');
const PLAN = 'docs/Plan wdrożenia #2.md';

test.use({ baseURL: 'http://127.0.0.1:4599' });

test('comments from both panes are shared, editable and persistent', async ({ page }) => {
  await page.goto('/?token=e2e');
  await page.locator('.tree-file', { hasText: 'guide.md' }).click();
  await expect(page.locator('.file-path')).toHaveText('docs/guide.md');

  const raw = page.locator('[data-pane="raw"]');
  const render = page.locator('[data-pane="render"]');
  const field = page.getByPlaceholder('Treść komentarza');

  await test.step('Esc cancels a draft and an empty comment cannot be saved', async () => {
    await raw.locator('.raw-line').nth(0).hover();
    await raw.getByRole('button', { name: 'Dodaj komentarz: 1', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Zapisz' })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(field).toHaveCount(0);
  });

  await test.step('a comment added in the raw pane shows in both panes', async () => {
    await raw.locator('.raw-line').nth(2).hover();
    await raw.getByRole('button', { name: 'Dodaj komentarz: 3', exact: true }).click();
    await field.fill('podaj komendę npx');
    await page.keyboard.press('ControlOrMeta+Enter');
    await expect(raw.locator('.comment')).toHaveCount(1);
    await expect(render.locator('.comment')).toHaveText(/podaj komendę npx/);
  });

  await test.step('a comment added on a rendered block lands on its source line', async () => {
    await render.locator('li', { hasText: 'krok drugi' }).hover();
    await render.getByRole('button', { name: 'Dodaj komentarz: 6', exact: true }).click();
    await field.fill('rozwiń ten krok');
    await page.getByRole('button', { name: 'Zapisz' }).click();
    await expect(raw.locator('.comment')).toHaveCount(2);
    await expect(page.locator('.tree-file', { hasText: 'guide.md' }).locator('.count')).toHaveText('2');
  });

  await test.step('editing changes the text in both panes', async () => {
    await raw.locator('.comment').first().getByRole('button', { name: 'Edytuj' }).click();
    await raw.locator('.comment').first().getByPlaceholder('Treść komentarza').fill('podaj komendę npx docsreview');
    await page.keyboard.press('ControlOrMeta+Enter');
    await expect(render.locator('.comment').first()).toContainText('podaj komendę npx docsreview');
  });

  await test.step('comments survive a reload', async () => {
    await page.reload();
    await expect(page.locator('.file-path')).toHaveText('docs/guide.md');
    await expect(raw.locator('.comment')).toHaveCount(2);
  });

  await test.step('a resolved comment is hidden until resolved comments are shown', async () => {
    await raw.locator('.comment').first().getByRole('button', { name: 'Rozwiąż' }).click();
    await expect(raw.locator('.comment')).toHaveCount(1);
    await page.getByLabel('Pokaż rozwiązane').check();
    await expect(raw.locator('.comment.resolved')).toContainText('rozwiązany');
    await raw.locator('.comment.resolved').getByRole('button', { name: 'Usuń' }).click();
    await expect(raw.locator('.comment')).toHaveCount(1);
  });
});

test('a draft survives file changes and saving it on a changed file asks to check the line', async ({ page }) => {
  await page.goto('/?token=e2e');
  await page.locator('.tree-file', { hasText: 'guide.md' }).click();
  const raw = page.locator('[data-pane="raw"]');
  const render = page.locator('[data-pane="render"]');
  const field = page.getByPlaceholder('Treść komentarza');
  const original = await fs.readFile(GUIDE, 'utf8');

  await render.locator('li', { hasText: 'krok pierwszy' }).hover();
  await render.getByRole('button', { name: 'Dodaj komentarz: 5', exact: true }).click();
  await field.fill('w trakcie pisania');

  await test.step('the typed text survives a refresh caused by another file appearing', async () => {
    await fs.writeFile(path.join(ROOT, 'docs/later.md'), '# Później\n');
    await expect(page.locator('.tree-file', { hasText: 'later.md' })).toBeVisible();
    await expect(field).toHaveValue('w trakcie pisania');
  });

  await test.step('the typed text survives a change of the open file', async () => {
    await fs.writeFile(GUIDE, `Nowa pierwsza linia.\n\n${original}`);
    await expect(render.locator('p', { hasText: 'Nowa pierwsza linia.' })).toBeVisible();
    await expect(field).toHaveValue('w trakcie pisania');
  });

  await test.step('saving on the changed file asks to check the line and creates no comment', async () => {
    await page.getByRole('button', { name: 'Zapisz' }).click();
    await expect(page.getByRole('alert')).toContainText('Plik zmienił się w trakcie pisania');
    await expect(field).toHaveValue('w trakcie pisania');
    await expect(page.locator('.comment', { hasText: 'w trakcie pisania' })).toHaveCount(0);
  });

  await test.step('saving again creates the comment on the draft line in the current content', async () => {
    await page.getByRole('button', { name: 'Zapisz' }).click();
    await expect(field).toHaveCount(0);
    await expect(render.locator('.comment', { hasText: 'w trakcie pisania' })).toHaveCount(1);
    await expect(raw.locator('.raw-line[data-line-start="5"] + .raw-comments .comment')).toContainText(
      'w trakcie pisania',
    );
  });

  await fs.writeFile(GUIDE, original);
  await expect(render.locator('p', { hasText: 'Nowa pierwsza linia.' })).toHaveCount(0);
});

test('a file name with spaces, Polish letters and a hash sign opens and survives a reload', async ({ page }) => {
  await page.goto('/?token=e2e');
  await page.locator('.tree-file', { hasText: 'Plan wdrożenia #2.md' }).click();
  await expect(page.locator('.file-path')).toHaveText(PLAN);
  await expect(page.locator('[data-pane="render"] h1')).toHaveText('Plan');

  await page.reload();
  await expect(page.locator('.file-path')).toHaveText(PLAN);

  await fs.rm(path.join(ROOT, PLAN));
  await expect(page.locator('.main .empty')).toHaveText('Plik nie istnieje.');
  await expect(page.locator('.tree-file', { hasText: 'Plan wdrożenia #2.md' })).toHaveCount(0);
});

test('a relative link to a markdown file opens it in the same tab', async ({ page }) => {
  await page.goto('/?token=e2e');
  await page.locator('.tree-file', { hasText: 'links.md' }).click();
  await expect(page.locator('.file-path')).toHaveText('docs/links.md');

  await page.locator('[data-pane="render"] a', { hasText: 'przewodnik' }).click();
  await expect(page.locator('.file-path')).toHaveText('docs/guide.md');
  expect(page.context().pages()).toHaveLength(1);
});

test('double-clicking Save on a new draft creates exactly one comment', async ({ page }) => {
  await page.goto('/?token=e2e');
  await page.locator('.tree-file', { hasText: 'guide.md' }).click();
  const raw = page.locator('[data-pane="raw"]');

  await raw.locator('.raw-line').nth(0).hover();
  await raw.getByRole('button', { name: 'Dodaj komentarz: 1', exact: true }).click();
  await page.getByPlaceholder('Treść komentarza').fill('podwójny klik');
  await page.getByRole('button', { name: 'Zapisz' }).dblclick();

  await expect(raw.locator('.comment', { hasText: 'podwójny klik' })).toHaveCount(1);
  await page.waitForTimeout(500);
  await page.reload();
  await expect(page.locator('.file-path')).toHaveText('docs/guide.md');
  await expect(raw.locator('.comment', { hasText: 'podwójny klik' })).toHaveCount(1);
});

test('an edit of a comment in the rendered pane survives a change of the open file', async ({ page }) => {
  await page.goto('/?token=e2e');
  await page.locator('.tree-file', { hasText: 'guide.md' }).click();
  const raw = page.locator('[data-pane="raw"]');
  const render = page.locator('[data-pane="render"]');
  const original = await fs.readFile(GUIDE, 'utf8');

  await raw.locator('.raw-line').nth(2).hover();
  await raw.getByRole('button', { name: 'Dodaj komentarz: 3', exact: true }).click();
  await page.getByPlaceholder('Treść komentarza').fill('do edycji');
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(render.locator('.comment', { hasText: 'do edycji' })).toHaveCount(1);

  await render.locator('.comment', { hasText: 'do edycji' }).getByRole('button', { name: 'Edytuj' }).click();
  const editField = render.locator('.comment .comment-form textarea');
  await editField.fill('po edycji');

  await fs.writeFile(GUIDE, `Dopisana na górze.\n\n${original}`);
  await expect(render.locator('p', { hasText: 'Dopisana na górze.' })).toBeVisible();
  await expect(editField).toHaveValue('po edycji');

  await render.locator('.comment .comment-form').getByRole('button', { name: 'Zapisz' }).click();
  await expect(render.locator('.comment .comment-form')).toHaveCount(0);
  await expect(render.locator('.comment', { hasText: 'po edycji' })).toHaveCount(1);
  await expect(raw.locator('.comment', { hasText: 'po edycji' })).toHaveCount(1);

  await fs.writeFile(GUIDE, original);
  await expect(render.locator('p', { hasText: 'Dopisana na górze.' })).toHaveCount(0);
});

test('the raw pane highlights markdown syntax without changing the text', async ({ page }) => {
  await page.goto('/?token=e2e');
  await page.locator('.tree-file', { hasText: 'syntax.md' }).click();
  await expect(page.locator('.file-path')).toHaveText('docs/syntax.md');
  const lines = page.locator('[data-pane="raw"] .raw-line');

  await expect(lines.nth(0).locator('.md-heading')).toHaveText('# Składnia');
  await expect(lines.nth(2).locator('.md-inline-code')).toHaveText('`npm start`');
  await expect(lines.nth(2).locator('.md-strong')).toHaveText('**poczekaj**');
  await expect(lines.nth(4).locator('.md-marker')).toHaveText('-');
  await expect(lines.nth(6).locator('.md-fence')).toHaveText('```sh');
  await expect(lines.nth(7).locator('.md-code')).toHaveText('npm install');

  const text = await lines.nth(2).locator('.raw-text').evaluate((element) => element.textContent);
  expect(text).toBe('Uruchom `npm start` i **poczekaj**.');
  const headingColor = await lines.nth(0).locator('.md-heading').evaluate((element) => getComputedStyle(element).color);
  const plainColor = await lines.nth(4).locator('.raw-text').evaluate((element) => getComputedStyle(element).color);
  expect(headingColor).not.toBe(plainColor);
});

test('panes keep a readable width on an ultrawide window', async ({ page }) => {
  await page.setViewportSize({ width: 3440, height: 1200 });
  await page.goto('/?token=e2e');
  await page.locator('.tree-file', { hasText: 'syntax.md' }).click();
  await expect(page.locator('.file-path')).toHaveText('docs/syntax.md');

  const main = (await page.locator('.main').boundingBox())!;
  const raw = (await page.locator('.pane').nth(0).boundingBox())!;
  const render = (await page.locator('.pane').nth(1).boundingBox())!;
  expect(raw.width).toBeLessThanOrEqual(900);
  expect(render.width).toBeLessThanOrEqual(900);
  expect(Math.abs(raw.x + raw.width - render.x)).toBeLessThanOrEqual(1);
  const leftGap = raw.x - main.x;
  const rightGap = main.x + main.width - (render.x + render.width);
  expect(leftGap).toBeGreaterThan(100);
  expect(Math.abs(leftGap - rightGap)).toBeLessThanOrEqual(2);

  await page.getByRole('button', { name: /^Komentarze/ }).click();
  const list = (await page.locator('.comments-list').boundingBox())!;
  const output = (await page.locator('.output').boundingBox())!;
  expect(list.width).toBeLessThanOrEqual(900);
  expect(output.width).toBeLessThanOrEqual(900);
  expect(Math.abs(list.x - (3440 - (output.x + output.width)))).toBeLessThanOrEqual(2);

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole('button', { name: 'Pliki' }).click();
  await expect(page.locator('.file-path')).toHaveText('docs/syntax.md');
  const narrow = (await page.locator('.pane').nth(0).boundingBox())!;
  expect(Math.abs(narrow.width - (1280 - 280) / 2)).toBeLessThanOrEqual(1);
});
