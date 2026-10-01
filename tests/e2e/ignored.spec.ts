import { expect, test } from '@playwright/test';

test.use({ baseURL: 'http://127.0.0.1:4600' });

test('a working directory that git ignores points to the show-ignored switch', async ({ page }) => {
  await page.goto('/?token=e2e');
  await expect(page.locator('.main .empty')).toContainText('Brak plików .md w tym katalogu.');
  await expect(page.locator('.main .empty')).toContainText('Pokaż ignorowane');

  await page.getByLabel('Pokaż ignorowane').check();
  await expect(page.locator('.tree-file.ignored', { hasText: 'guide.md' })).toBeVisible();
  await expect(page.locator('.file-path')).toHaveText('docs/guide.md');
});
