import { test, expect } from '@playwright/test';

test.describe('Navigation', () => {
  test('should load the home page', async ({ page }) => {
    await page.goto('/');

    // Wait for the page to load
    await page.waitForSelector('table, .ant-empty', { timeout: 10000 });

    // Verify title
    await expect(page).toHaveTitle(/Node Drive/i);

    // Verify header is visible
    const header = page.locator('header, .ant-layout-header').first();
    await expect(header).toBeVisible();
  });

  test('should display breadcrumb navigation', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('table, .ant-empty', { timeout: 10000 });

    // Verify breadcrumb exists
    const breadcrumb = page.locator('nav, .ant-breadcrumb');
    await expect(breadcrumb.first()).toBeVisible();
  });

  test('should maintain state when navigating back and forth', async ({ page }) => {
    const testFolderName = `nav-test-${Date.now()}`;

    try {
      await page.goto('/');
      await page.waitForSelector('table, .ant-empty', { timeout: 10000 });

      // Create a test folder
      page.once('dialog', dialog => dialog.accept(testFolderName));
      await page.getByRole('button', { name: /new folder/i }).click();
      await page.waitForSelector(`text=${testFolderName}`, { timeout: 5000 });

      // Navigate into folder
      await page.getByText(testFolderName, { exact: true }).click();
      await page.waitForURL(`**/${testFolderName}/`, { timeout: 5000 });

      // Go back
      await page.goBack();
      await page.waitForLoadState('networkidle');

      // Verify folder still exists in list
      await expect(page.getByText(testFolderName)).toBeVisible();

      // Go forward
      await page.goForward();
      await page.waitForURL(`**/${testFolderName}/`, { timeout: 5000 });

      // Verify we're in the folder
      await expect(page.getByText(testFolderName)).toBeVisible();

      // Cleanup
      await page.goto('/');
      await page.waitForSelector('table', { timeout: 5000 });
      const deleteButton = page.locator(`tr:has-text("${testFolderName}") button`).last();
      page.once('dialog', dialog => dialog.accept());
      await deleteButton.click();
    } catch (e) {
      // Try cleanup on error
      try {
        await page.goto('/');
        await page.waitForSelector('table', { timeout: 5000 });
        const exists = await page.locator(`text=${testFolderName}`).count() > 0;
        if (exists) {
          const deleteButton = page.locator(`tr:has-text("${testFolderName}") button`).last();
          page.once('dialog', dialog => dialog.accept());
          await deleteButton.click();
        }
      } catch {}
      throw e;
    }
  });

  test('should update URL when navigating directories', async ({ page }) => {
    const testFolderName = `url-test-${Date.now()}`;

    try {
      await page.goto('/');
      await page.waitForSelector('table, .ant-empty', { timeout: 10000 });

      const initialUrl = page.url();

      // Create folder
      page.once('dialog', dialog => dialog.accept(testFolderName));
      await page.getByRole('button', { name: /new folder/i }).click();
      await page.waitForSelector(`text=${testFolderName}`, { timeout: 5000 });

      // Click folder
      await page.getByText(testFolderName, { exact: true }).click();

      // Wait for URL to change
      await page.waitForURL(`**/${testFolderName}/`, { timeout: 5000 });

      const newUrl = page.url();
      expect(newUrl).not.toBe(initialUrl);
      expect(newUrl).toContain(testFolderName);

      // Cleanup
      await page.goto('/');
      await page.waitForSelector('table', { timeout: 5000 });
      const deleteButton = page.locator(`tr:has-text("${testFolderName}") button`).last();
      page.once('dialog', dialog => dialog.accept());
      await deleteButton.click();
    } catch (e) {
      // Cleanup on error
      try {
        await page.goto('/');
        await page.waitForSelector('table', { timeout: 5000 });
        const exists = await page.locator(`text=${testFolderName}`).count() > 0;
        if (exists) {
          const deleteButton = page.locator(`tr:has-text("${testFolderName}") button`).last();
          page.once('dialog', dialog => dialog.accept());
          await deleteButton.click();
        }
      } catch {}
      throw e;
    }
  });

  test('should refresh content when URL changes', async ({ page }) => {
    const testFolder1 = `refresh-test-1-${Date.now()}`;
    const testFolder2 = `refresh-test-2-${Date.now()}`;

    try {
      await page.goto('/');
      await page.waitForSelector('table, .ant-empty', { timeout: 10000 });

      // Create two folders
      page.once('dialog', dialog => dialog.accept(testFolder1));
      await page.getByRole('button', { name: /new folder/i }).click();
      await page.waitForSelector(`text=${testFolder1}`, { timeout: 5000 });

      page.once('dialog', dialog => dialog.accept(testFolder2));
      await page.getByRole('button', { name: /new folder/i }).click();
      await page.waitForSelector(`text=${testFolder2}`, { timeout: 5000 });

      // Navigate to first folder
      await page.getByText(testFolder1, { exact: true }).click();
      await page.waitForURL(`**/${testFolder1}/`, { timeout: 5000 });

      // Verify empty folder message
      const isEmpty1 = await page.locator('text=/This folder is empty/i').count() > 0;
      expect(isEmpty1).toBeTruthy();

      // Navigate back and into second folder
      await page.goto('/');
      await page.waitForSelector('table', { timeout: 5000 });
      await page.getByText(testFolder2, { exact: true }).click();
      await page.waitForURL(`**/${testFolder2}/`, { timeout: 5000 });

      // Verify empty folder message again
      const isEmpty2 = await page.locator('text=/This folder is empty/i').count() > 0;
      expect(isEmpty2).toBeTruthy();

      // Cleanup
      await page.goto('/');
      await page.waitForSelector('table', { timeout: 5000 });

      let deleteButton = page.locator(`tr:has-text("${testFolder1}") button`).last();
      page.once('dialog', dialog => dialog.accept());
      await deleteButton.click();
      await page.waitForTimeout(1000);

      deleteButton = page.locator(`tr:has-text("${testFolder2}") button`).last();
      page.once('dialog', dialog => dialog.accept());
      await deleteButton.click();
    } catch (e) {
      // Cleanup on error
      try {
        await page.goto('/');
        await page.waitForSelector('table', { timeout: 5000 });

        for (const folder of [testFolder1, testFolder2]) {
          const exists = await page.locator(`text=${folder}`).count() > 0;
          if (exists) {
            const deleteButton = page.locator(`tr:has-text("${folder}") button`).last();
            page.once('dialog', dialog => dialog.accept());
            await deleteButton.click();
            await page.waitForTimeout(500);
          }
        }
      } catch {}
      throw e;
    }
  });
});
