import { test, expect } from '@playwright/test';

test.describe('Folder Operations', () => {
  const testFolderName = `test-folder-${Date.now()}`;

  test.afterEach(async ({ page }) => {
    // Cleanup: try to delete the test folder if it exists
    try {
      await page.goto('/');
      await page.waitForSelector('table', { timeout: 5000 });

      const folderExists = await page.locator(`text=${testFolderName}`).count() > 0;
      if (folderExists) {
        const deleteButton = page.locator(`tr:has-text("${testFolderName}") button`).last();
        page.once('dialog', dialog => dialog.accept());
        await deleteButton.click();
        await page.waitForTimeout(1000);
      }
    } catch (e) {
      // Ignore cleanup errors
    }
  });

  test('should create a new folder', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('table', { timeout: 10000 });

    const initialRows = await page.locator('table tbody tr').count();

    // Click "New Folder" button
    page.once('dialog', dialog => {
      dialog.accept(testFolderName);
    });
    await page.getByRole('button', { name: /new folder/i }).click();

    // Wait for the folder to appear
    await page.waitForSelector(`text=${testFolderName}`, { timeout: 5000 });

    // Verify folder appears in table
    const newRows = await page.locator('table tbody tr').count();
    expect(newRows).toBe(initialRows + 1);

    // Verify it's actually a folder (has folder icon)
    const folderRow = page.locator(`tr:has-text("${testFolderName}")`);
    await expect(folderRow.locator('[data-icon="folder"]').or(folderRow.locator('svg').first())).toBeVisible();
  });

  test('should navigate into a folder', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('table', { timeout: 10000 });

    // Create folder
    page.once('dialog', dialog => dialog.accept(testFolderName));
    await page.getByRole('button', { name: /new folder/i }).click();
    await page.waitForSelector(`text=${testFolderName}`, { timeout: 5000 });

    // Click on the folder to navigate into it
    await page.getByText(testFolderName, { exact: true }).click();

    // Wait for navigation
    await page.waitForURL(`**/${testFolderName}/`, { timeout: 5000 });

    // Verify breadcrumb shows the folder name
    await expect(page.getByText(testFolderName)).toBeVisible();

    // Verify empty folder message or table
    const isEmpty = await page.locator('text=/This folder is empty/i').count() > 0;
    expect(isEmpty || await page.locator('table').count() > 0).toBeTruthy();
  });

  test('should navigate back using breadcrumb', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('table', { timeout: 10000 });

    // Create folder and navigate into it
    page.once('dialog', dialog => dialog.accept(testFolderName));
    await page.getByRole('button', { name: /new folder/i }).click();
    await page.waitForSelector(`text=${testFolderName}`, { timeout: 5000 });
    await page.getByText(testFolderName, { exact: true }).click();
    await page.waitForURL(`**/${testFolderName}/`, { timeout: 5000 });

    // Click on root breadcrumb to go back
    const breadcrumbLinks = page.locator('nav a, .ant-breadcrumb a').first();
    await breadcrumbLinks.click();

    // Verify we're back at root
    await page.waitForURL('/', { timeout: 5000 });
    await expect(page.getByText(testFolderName)).toBeVisible();
  });

  test('should delete an empty folder', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('table', { timeout: 10000 });

    // Create folder
    page.once('dialog', dialog => dialog.accept(testFolderName));
    await page.getByRole('button', { name: /new folder/i }).click();
    await page.waitForSelector(`text=${testFolderName}`, { timeout: 5000 });

    const initialRows = await page.locator('table tbody tr').count();

    // Delete the folder
    const deleteButton = page.locator(`tr:has-text("${testFolderName}") button`).last();
    page.once('dialog', dialog => dialog.accept());
    await deleteButton.click();

    // Wait for folder to disappear
    await page.waitForSelector(`text=${testFolderName}`, { state: 'detached', timeout: 5000 });

    const newRows = await page.locator('table tbody tr').count();
    expect(newRows).toBe(initialRows - 1);
  });
});
