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

test('a draft is not lost when files change while typing', async ({ page }) => {
  await page.goto('/?token=e2e');
  await page.locator('.tree-file', { hasText: 'guide.md' }).click();
  const render = page.locator('[data-pane="render"]');
  const field = page.getByPlaceholder('Treść komentarza');

  await render.locator('li', { hasText: 'krok pierwszy' }).hover();
  await render.getByRole('button', { name: 'Dodaj komentarz: 5', exact: true }).click();
  await field.fill('w trakcie pisania');

  await fs.writeFile(path.join(ROOT, 'docs/later.md'), '# Później\n');
  await expect(page.locator('.tree-file', { hasText: 'later.md' })).toBeVisible();
  await expect(field).toHaveValue('w trakcie pisania');

  const original = await fs.readFile(GUIDE, 'utf8');
  await fs.writeFile(GUIDE, `Nowa pierwsza linia.\n\n${original}`);
  await expect(render.locator('p', { hasText: 'Nowa pierwsza linia.' })).toBeVisible();
  await expect(field).toHaveValue('w trakcie pisania');

  await fs.writeFile(GUIDE, original);
  await expect(render.locator('p', { hasText: 'Nowa pierwsza linia.' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Zapisz' }).click();
  await expect(render.locator('.comment', { hasText: 'w trakcie pisania' })).toBeVisible();
});

test('saving a comment on a file that just changed asks to check the line', async ({ page }) => {
  await page.goto('/?token=e2e');
  await page.locator('.tree-file', { hasText: 'guide.md' }).click();
  const raw = page.locator('[data-pane="raw"]');
  const field = page.getByPlaceholder('Treść komentarza');

  await raw.locator('.raw-line').nth(0).hover();
  await raw.getByRole('button', { name: 'Dodaj komentarz: 1', exact: true }).click();
  await field.fill('tytuł do zmiany');

  await page.route(/\/api\/file\?/, (route) => route.abort());
  const original = await fs.readFile(GUIDE, 'utf8');
  await fs.writeFile(GUIDE, `${original}\nDopisana linia.\n`);
  await expect(page.getByRole('alert')).toContainText('Brak połączenia');
  await page.unroute(/\/api\/file\?/);
  await page.getByRole('button', { name: 'Zapisz' }).click();

  await expect(page.getByRole('alert')).toContainText('Plik zmienił się w trakcie pisania');
  await expect(field).toHaveValue('tytuł do zmiany');
  await expect(raw.locator('.raw-line')).toHaveCount(8);
  await page.getByRole('button', { name: 'Zapisz' }).click();
  await expect(raw.locator('.comment', { hasText: 'tytuł do zmiany' })).toBeVisible();
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
