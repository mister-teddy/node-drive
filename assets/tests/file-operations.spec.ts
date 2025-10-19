import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import os from 'os';

test.describe('File Operations', () => {
  let testDir: string;
  let testFile: string;
  const testFileName = `test-file-${Date.now()}.txt`;

  test.beforeEach(async ({ page }) => {
    // Create a temporary test file
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'node-drive-test-'));
    testFile = path.join(testDir, testFileName);
    fs.writeFileSync(testFile, 'Test content for file operations');

    // Upload the test file
    await page.goto('/');
    await page.waitForSelector('table', { timeout: 10000 });
    await page.getByRole('button', { name: /new file/i }).click();
    const fileInput = await page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(testFile);
    await page.waitForSelector(`text=${testFileName}`, { timeout: 10000 });
  });

  test.afterEach(async ({ page }) => {
    // Cleanup uploaded files
    try {
      await page.goto('/');
      await page.waitForSelector('table', { timeout: 5000 });

      // Delete test file if it exists
      const fileExists = await page.locator(`text=${testFileName}`).count() > 0;
      if (fileExists) {
        const deleteButton = page.locator(`tr:has-text("${testFileName}") button`).last();
        page.once('dialog', dialog => dialog.accept());
        await deleteButton.click();
        await page.waitForTimeout(1000);
      }

      // Delete moved file if it exists
      const movedFileName = `moved-${testFileName}`;
      const movedExists = await page.locator(`text=${movedFileName}`).count() > 0;
      if (movedExists) {
        const deleteButton = page.locator(`tr:has-text("${movedFileName}") button`).last();
        page.once('dialog', dialog => dialog.accept());
        await deleteButton.click();
        await page.waitForTimeout(1000);
      }
    } catch (e) {
      // Ignore cleanup errors
    }

    // Cleanup temp directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('should view a file in drawer', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('table', { timeout: 10000 });

    // Click on the file name to view
    const fileLink = page.locator(`tr:has-text("${testFileName}") a`).first();
    await expect(fileLink).toBeVisible();

    // Click to open drawer
    await fileLink.click();

    // Wait for drawer to appear
    await page.waitForSelector('.ant-drawer', { timeout: 5000 });

    const drawer = page.locator('.ant-drawer');
    await expect(drawer).toBeVisible();

    // Verify drawer contains the file name
    await expect(drawer.locator(`text=${testFileName}`)).toBeVisible();

    // Verify drawer has content (either preview or download button)
    const drawerBody = drawer.locator('.ant-drawer-body');
    await expect(drawerBody).toBeVisible();

    // Close the drawer
    const closeButton = drawer.locator('.ant-drawer-close, button:has([data-icon="close"])').first();
    await closeButton.click();

    // Wait for drawer to close
    await page.waitForSelector('.ant-drawer', { state: 'detached', timeout: 5000 });
  });

  test('should open file in new tab from drawer', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('table', { timeout: 10000 });

    // Click on file to open drawer
    const fileLink = page.locator(`tr:has-text("${testFileName}") a`).first();
    await fileLink.click();

    // Wait for drawer
    await page.waitForSelector('.ant-drawer', { timeout: 5000 });

    // Click "Open in New Tab" button in drawer
    const openNewTabButton = page.locator('.ant-drawer').getByText(/open in new tab/i);

    const [newPage] = await Promise.all([
      page.context().waitForEvent('page'),
      openNewTabButton.click()
    ]);

    // Verify new page opened with the file
    await newPage.waitForLoadState('load', { timeout: 10000 });
    expect(newPage.url()).toContain(testFileName);

    await newPage.close();
  });

  test('should download a file', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('table', { timeout: 10000 });

    // Click the download button
    const downloadButton = page.locator(`tr:has-text("${testFileName}") button`).first();

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      downloadButton.click()
    ]);

    // Verify download
    expect(download.suggestedFilename()).toBe(testFileName);

    // Save and verify the file
    const downloadPath = path.join(testDir, 'downloaded-' + testFileName);
    await download.saveAs(downloadPath);
    expect(fs.existsSync(downloadPath)).toBeTruthy();
    const content = fs.readFileSync(downloadPath, 'utf-8');
    expect(content).toBe('Test content for file operations');
  });

  test('should delete a file', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('table', { timeout: 10000 });

    const initialRows = await page.locator('table tbody tr').count();

    // Click delete button
    const deleteButton = page.locator(`tr:has-text("${testFileName}") button`).last();

    // Accept confirmation dialog
    page.once('dialog', dialog => {
      expect(dialog.message()).toContain(testFileName);
      dialog.accept();
    });

    await deleteButton.click();

    // Wait for file to be removed from table
    await page.waitForSelector(`text=${testFileName}`, { state: 'detached', timeout: 5000 });

    const newRows = await page.locator('table tbody tr').count();
    expect(newRows).toBe(initialRows - 1);
  });

  test('should move/rename a file', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('table', { timeout: 10000 });

    // Find and click the move button (drag icon)
    const moveButton = page.locator(`tr:has-text("${testFileName}") button[aria-label*="Move"], tr:has-text("${testFileName}") button`).nth(1);

    const newFileName = `moved-${testFileName}`;
    const newPath = `/${newFileName}`;

    // Handle the prompt dialog
    page.once('dialog', async dialog => {
      expect(dialog.type()).toBe('prompt');
      await dialog.accept(newPath);
    });

    await moveButton.click();

    // Wait for page reload
    await page.waitForLoadState('networkidle', { timeout: 10000 });

    // Verify old file name is gone
    await page.waitForSelector(`text=${testFileName}`, { state: 'detached', timeout: 5000 });

    // Verify new file name appears
    await expect(page.getByText(newFileName)).toBeVisible();
  });

  test('should display file size correctly', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('table', { timeout: 10000 });

    // Find the row with our test file
    const fileRow = page.locator(`tr:has-text("${testFileName}")`);

    // Verify size column exists and has content
    const sizeCell = fileRow.locator('td').nth(2); // Size is typically the 3rd column
    await expect(sizeCell).toBeVisible();

    const sizeText = await sizeCell.textContent();
    expect(sizeText).toBeTruthy();
    expect(sizeText).toMatch(/\d+\s*(B|KB|MB|GB)/i);
  });

  test('should display modification time', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('table', { timeout: 10000 });

    const fileRow = page.locator(`tr:has-text("${testFileName}")`);

    // Verify modified time column
    const mtimeCell = fileRow.locator('td').nth(3); // Modified is typically 4th column
    await expect(mtimeCell).toBeVisible();

    const timeText = await mtimeCell.textContent();
    expect(timeText).toBeTruthy();
    // Should contain time information
    expect(timeText).toMatch(/\d+/);
  });

  test('should preview text file content in drawer', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('table', { timeout: 10000 });

    // Click on file to open drawer
    const fileLink = page.locator(`tr:has-text("${testFileName}") a`).first();
    await fileLink.click();

    // Wait for drawer
    await page.waitForSelector('.ant-drawer', { timeout: 5000 });

    // Wait for content to load (text preview)
    await page.waitForTimeout(1000); // Give it time to fetch and render

    const drawer = page.locator('.ant-drawer');

    // Verify the content is displayed (should contain "Test content for file operations")
    const hasContent = await drawer.locator('text=/Test content/i').count() > 0;

    // Or verify pre tag exists (for text files)
    const hasPreTag = await drawer.locator('pre').count() > 0;

    expect(hasContent || hasPreTag).toBeTruthy();

    // Close drawer
    const closeButton = drawer.locator('.ant-drawer-close').first();
    await closeButton.click();
  });

  test('should show download button in drawer for all files', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('table', { timeout: 10000 });

    // Open drawer
    const fileLink = page.locator(`tr:has-text("${testFileName}") a`).first();
    await fileLink.click();

    await page.waitForSelector('.ant-drawer', { timeout: 5000 });

    // Verify download button exists in drawer header
    const downloadButton = page.locator('.ant-drawer').getByRole('button', { name: /download/i });
    await expect(downloadButton).toBeVisible();

    // Close drawer
    await page.keyboard.press('Escape');
  });
});
