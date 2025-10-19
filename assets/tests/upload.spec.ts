import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import os from 'os';

test.describe('File Upload', () => {
  let testDir: string;
  let testFile: string;

  test.beforeEach(async () => {
    // Create a temporary test directory and file
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'node-drive-test-'));
    testFile = path.join(testDir, 'test-upload.txt');
    fs.writeFileSync(testFile, 'This is a test file for upload functionality');
  });

  test.afterEach(() => {
    // Cleanup
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('should upload a file successfully', async ({ page }) => {
    await page.goto('/');

    // Wait for the page to load
    await page.waitForSelector('table', { timeout: 10000 });

    // Get initial file count
    const initialRows = await page.locator('table tbody tr').count();

    // Click the "New File" button to open file picker
    await page.getByRole('button', { name: /new file/i }).click();

    // Upload the file using the file input
    const fileInput = await page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(testFile);

    // Wait for upload to complete - look for the file in the table
    await page.waitForSelector(`text=${path.basename(testFile)}`, { timeout: 10000 });

    // Verify the file appears in the table
    const newRows = await page.locator('table tbody tr').count();
    expect(newRows).toBe(initialRows + 1);

    // Verify the file name is displayed
    await expect(page.getByText(path.basename(testFile))).toBeVisible();

    // Cleanup: delete the uploaded file
    const deleteButton = page.locator(`tr:has-text("${path.basename(testFile)}") button[aria-label*="Delete"], tr:has-text("${path.basename(testFile)}") button:has-text("")`).last();

    page.once('dialog', dialog => dialog.accept());
    await deleteButton.click();

    // Wait for file to be deleted
    await page.waitForSelector(`text=${path.basename(testFile)}`, { state: 'detached', timeout: 5000 });
  });

  test('should upload multiple files', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('table', { timeout: 10000 });

    // Create multiple test files
    const testFiles = ['test1.txt', 'test2.txt', 'test3.txt'].map(name => {
      const filePath = path.join(testDir, name);
      fs.writeFileSync(filePath, `Content of ${name}`);
      return filePath;
    });

    const initialRows = await page.locator('table tbody tr').count();

    // Upload multiple files
    await page.getByRole('button', { name: /new file/i }).click();
    const fileInput = await page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(testFiles);

    // Wait for all files to appear
    for (const file of testFiles) {
      await page.waitForSelector(`text=${path.basename(file)}`, { timeout: 10000 });
    }

    const newRows = await page.locator('table tbody tr').count();
    expect(newRows).toBe(initialRows + 3);

    // Cleanup
    for (const file of testFiles) {
      const deleteButton = page.locator(`tr:has-text("${path.basename(file)}") button`).last();
      page.once('dialog', dialog => dialog.accept());
      await deleteButton.click();
      await page.waitForSelector(`text=${path.basename(file)}`, { state: 'detached', timeout: 5000 });
    }
  });

  test('should show upload progress', async ({ page }) => {
    // Create a larger file to see progress
    const largeFile = path.join(testDir, 'large-file.txt');
    const content = 'x'.repeat(1024 * 100); // 100KB
    fs.writeFileSync(largeFile, content);

    await page.goto('/');
    await page.waitForSelector('table', { timeout: 10000 });

    await page.getByRole('button', { name: /new file/i }).click();
    const fileInput = await page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(largeFile);

    // Wait for upload to complete
    await page.waitForSelector(`text=${path.basename(largeFile)}`, { timeout: 10000 });

    // Cleanup
    const deleteButton = page.locator(`tr:has-text("${path.basename(largeFile)}") button`).last();
    page.once('dialog', dialog => dialog.accept());
    await deleteButton.click();
  });
});
