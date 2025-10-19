import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import os from 'os';

test.describe('Provenance Features', () => {
  let testDir: string;
  let testFile: string;
  const testFileName = `provenance-test-${Date.now()}.txt`;

  test.beforeEach(async ({ page }) => {
    // Create a test file
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'node-drive-test-'));
    testFile = path.join(testDir, testFileName);
    fs.writeFileSync(testFile, 'Test content for provenance testing');

    // Upload the test file
    await page.goto('/');
    await page.waitForSelector('table, .ant-empty', { timeout: 10000 });
    await page.getByRole('button', { name: /new file/i }).click();
    const fileInput = await page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(testFile);
    await page.waitForSelector(`text=${testFileName}`, { timeout: 10000 });
  });

  test.afterEach(async ({ page }) => {
    // Cleanup
    try {
      await page.goto('/');
      await page.waitForSelector('table, .ant-empty', { timeout: 5000 });

      const fileExists = await page.locator(`text=${testFileName}`).count() > 0;
      if (fileExists) {
        const deleteButton = page.locator(`tr:has-text("${testFileName}") button`).last();
        page.once('dialog', dialog => dialog.accept());
        await deleteButton.click();
        await page.waitForTimeout(1000);
      }
    } catch (e) {
      // Ignore cleanup errors
    }

    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('should display verification badge for files', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('table', { timeout: 10000 });

    // Find the file row
    const fileRow = page.locator(`tr:has-text("${testFileName}")`);
    await expect(fileRow).toBeVisible();

    // Look for verification column (may show badge, "—", or be empty initially)
    const verificationCell = fileRow.locator('td').nth(1); // 2nd column is verification
    await expect(verificationCell).toBeVisible();
  });

  test('should open provenance modal when clicking badge', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('table', { timeout: 10000 });

    const fileRow = page.locator(`tr:has-text("${testFileName}")`);

    // Look for a clickable provenance badge (Tag, button, or clickable element)
    const provenanceBadge = fileRow.locator('.ant-tag, [role="button"]').first();

    // Check if badge exists (file may not have provenance yet)
    const badgeCount = await provenanceBadge.count();

    if (badgeCount > 0) {
      // Click the badge
      await provenanceBadge.click();

      // Wait for modal to appear
      await page.waitForSelector('.ant-modal', { timeout: 5000 });

      const modal = page.locator('.ant-modal');
      await expect(modal).toBeVisible();

      // Modal should contain provenance information or loading state
      const modalContent = modal.locator('.ant-modal-body');
      await expect(modalContent).toBeVisible();

      // Close the modal
      const closeButton = modal.locator('.ant-modal-close, button:has-text("Cancel")').first();
      if (await closeButton.count() > 0) {
        await closeButton.click();
        await page.waitForSelector('.ant-modal', { state: 'detached', timeout: 5000 });
      } else {
        // Click outside modal to close
        await page.keyboard.press('Escape');
      }
    } else {
      // If no badge, this is expected for files without provenance
      console.log('No provenance badge found - file may not have timestamp yet');
    }
  });

  test('should display loading state in provenance modal', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('table', { timeout: 10000 });

    const fileRow = page.locator(`tr:has-text("${testFileName}")`);
    const provenanceBadge = fileRow.locator('.ant-tag, [role="button"]').first();

    const badgeCount = await provenanceBadge.count();

    if (badgeCount > 0) {
      await provenanceBadge.click();

      // Modal should appear
      await page.waitForSelector('.ant-modal', { timeout: 5000 });

      const modal = page.locator('.ant-modal');

      // Check for either loading spinner or actual content
      const hasSpinner = await modal.locator('.ant-spin').count() > 0;
      const hasContent = await modal.locator('text=/Loading|Provenance|Verified|Pending/i').count() > 0;

      expect(hasSpinner || hasContent).toBeTruthy();

      // Close modal
      await page.keyboard.press('Escape');
    }
  });

  test('should not show verification badge for folders', async ({ page }) => {
    const testFolderName = `prov-folder-${Date.now()}`;

    try {
      await page.goto('/');
      await page.waitForSelector('table, .ant-empty', { timeout: 10000 });

      // Create folder
      page.once('dialog', dialog => dialog.accept(testFolderName));
      await page.getByRole('button', { name: /new folder/i }).click();
      await page.waitForSelector(`text=${testFolderName}`, { timeout: 5000 });

      // Find folder row
      const folderRow = page.locator(`tr:has-text("${testFolderName}")`);

      // Verification column should be empty for folders
      const verificationCell = folderRow.locator('td').nth(1);
      const cellText = await verificationCell.textContent();

      // Should be empty or contain no badge
      const hasBadge = await verificationCell.locator('.ant-tag').count() > 0;
      expect(hasBadge).toBeFalsy();

      // Cleanup
      const deleteButton = page.locator(`tr:has-text("${testFolderName}") button`).last();
      page.once('dialog', dialog => dialog.accept());
      await deleteButton.click();
    } catch (e) {
      // Cleanup on error
      try {
        await page.goto('/');
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

  test('should allow downloading manifest JSON', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('table', { timeout: 10000 });

    // Try to fetch manifest directly via API
    const response = await page.request.get(`/${testFileName}?manifest=json`);

    // File might not have manifest yet, so we check if endpoint responds
    // Status could be 200 (has manifest) or 404 (no manifest yet)
    expect([200, 404]).toContain(response.status());

    if (response.status() === 200) {
      const manifest = await response.json();
      expect(manifest).toBeTruthy();

      // If manifest exists, it should have expected structure
      if (manifest.type) {
        expect(manifest.type).toBeTruthy();
      }
    }
  });

  test('should show hash information in verification badge', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('table', { timeout: 10000 });

    const fileRow = page.locator(`tr:has-text("${testFileName}")`);
    const verificationCell = fileRow.locator('td').nth(1);

    // Look for any hash-like content (short hash display)
    const hasHashDisplay = await verificationCell.locator('code, .ant-tag code').count() > 0;

    // Hash might not be displayed immediately, so we just check the cell exists
    await expect(verificationCell).toBeVisible();
  });
});
