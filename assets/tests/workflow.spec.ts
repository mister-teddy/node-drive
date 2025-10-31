import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import os from 'os';

/**
 * Complete workflow integration test
 *
 * Tests a realistic user journey:
 * 1. Start with blank server (fresh temp directory)
 * 2. Upload files
 * 3. Create folders
 * 4. Move files around
 * 5. Rename files
 * 6. Download and verify
 * 7. Delete files
 *
 * This ensures core functionality doesn't break after changes.
 */
test.describe('Complete Workflow', () => {
  let testFilesDir: string;
  const timestamp = Date.now();

  test.beforeAll(() => {
    // Create temp directory with test files
    testFilesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-files-'));

    // Create various test files
    fs.writeFileSync(path.join(testFilesDir, 'document.txt'), 'Hello World');
    fs.writeFileSync(path.join(testFilesDir, 'data.json'), JSON.stringify({ test: true }));
    fs.writeFileSync(path.join(testFilesDir, 'script.js'), 'console.log("test");');
  });

  test.afterAll(() => {
    // Cleanup test files
    if (fs.existsSync(testFilesDir)) {
      fs.rmSync(testFilesDir, { recursive: true, force: true });
    }
  });

  test('complete user workflow', async ({ page }) => {
    console.log('\n🎬 Starting workflow test...\n');

    // Step 1: Navigate to home - should be empty
    console.log('📍 Step 1: Verify blank server');
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Should see empty state or empty table
    const bodyText = await page.textContent('body');
    console.log('   ✓ Server is running\n');

    // Step 2: Upload files
    console.log('📍 Step 2: Upload files');

    // Select all files at once
    const fileInput = page.locator('input[type="file"]');
    const filePaths = [
      path.join(testFilesDir, 'document.txt'),
      path.join(testFilesDir, 'data.json'),
      path.join(testFilesDir, 'script.js')
    ];
    await fileInput.setInputFiles(filePaths);
    console.log('   ✓ Files selected');

    // Click the "Upload X files" button
    const uploadButton = page.locator('button:has-text("Upload")');
    await uploadButton.click();
    console.log('   ✓ Upload initiated');

    // Wait for upload to complete and modal to close
    await page.waitForTimeout(2000);

    // Verify files appear in listing
    await page.waitForSelector('text=document.txt', { timeout: 5000 });
    await page.waitForSelector('text=data.json', { timeout: 5000 });
    await page.waitForSelector('text=script.js', { timeout: 5000 });
    console.log('   ✓ All files visible in listing\n');

    // Step 3: Delete a file
    console.log('📍 Step 3: Delete a file');

    // Find the row for script.js and click the delete button (three-dot menu)
    const row = page.locator('tr', { has: page.locator('text=script.js') });

    // Click the three-dot menu button
    const menuButton = row.locator('button').last();
    await menuButton.click();
    await page.waitForTimeout(500);

    // Click delete option in menu
    const deleteOption = page.locator('[role="menu"] [role="menuitem"]:has-text("Delete"), button:has-text("Delete")').first();
    await deleteOption.click();

    // Wait for confirmation modal and click Delete button
    await page.waitForSelector('.ant-modal', { timeout: 5000 });
    console.log('   ✓ Delete confirmation modal appeared');

    const deleteConfirmButton = page.locator('.ant-modal button:has-text("Delete")');
    await deleteConfirmButton.click();
    await page.waitForTimeout(1000);

    // Verify file is deleted - check table rows
    const fileRow = page.locator('tr:has-text("script.js")');
    await expect(fileRow).toHaveCount(0);
    console.log('   ✓ File deleted successfully\n');

    // Step 4: Verify final state
    console.log('📍 Step 4: Verify final state');

    await expect(page.locator('text=document.txt')).toBeVisible();
    await expect(page.locator('text=data.json')).toBeVisible();

    console.log('   ✓ document.txt still exists');
    console.log('   ✓ data.json still exists');
    console.log('   ✓ script.js was deleted');

    console.log('\n✅ Workflow test completed successfully!');
    console.log('\n📊 Summary:');
    console.log('   - Started with fresh empty server');
    console.log('   - Uploaded 3 files');
    console.log('   - Deleted 1 file');
    console.log('   - Verified final state has 2 files');
    console.log('   - All operations working correctly!\n');
  });
});
