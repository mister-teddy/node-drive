# Node Drive E2E Tests

Comprehensive end-to-end tests for Node Drive using Playwright.

## Setup

Install dependencies:

```bash
pnpm install
```

Install Playwright browsers:

```bash
pnpm exec playwright install
```

## Running Tests

### Run all tests (headless)

```bash
pnpm test
```

### Run tests with UI mode (recommended for development)

```bash
pnpm test:ui
```

### Run tests in headed mode (see browser)

```bash
pnpm test:headed
```

### Debug a specific test

```bash
pnpm test:debug
```

### View test report

```bash
pnpm test:report
```

### Test against VPS deployment

```bash
VPS_URL=http://your-vps:8080 pnpm test
```

## Test Suites

### Workflow Integration Test (`workflow.spec.ts`)

Complete user workflow test that validates core functionality:

- **Upload files**: Multiple files uploaded via file input
- **View files**: Files displayed in table with metadata
- **Delete files**: Delete operation with confirmation modal
- **Verify state**: Final state validation

This test runs with a **fresh temporary directory** to ensure a clean testing environment.

**What it validates:**
1. Blank server starts correctly
2. File upload works (multiple files at once)
3. Files appear in listing with correct metadata
4. Delete confirmation modal works
5. File deletion works correctly
6. Final state is accurate

## Test Configuration

The tests are configured to:

- **Local testing**: Auto-start server with fresh temp directory at `/tmp/node-drive-test-*`
- **VPS testing**: Skip local server, test against `VPS_URL` environment variable
- Run sequentially to avoid file operation conflicts
- Capture screenshots on failure
- Generate HTML reports
- Support retries in CI (3 retries for network flakiness)

## Prerequisites

Before running tests, ensure:

1. The Rust project builds successfully: `cargo build`
2. The frontend builds successfully: `pnpm build`
3. Port 5000 is available (for local testing)

## CI/CD Integration

The workflow test runs automatically in GitHub Actions:

1. **Local testing** (pre-merge): `pnpm test` in CI
2. **VPS deployment testing** (post-deploy): `VPS_URL=http://vps:8080 pnpm test workflow.spec.ts`

This ensures functionality works both locally and on deployed infrastructure.

## Troubleshooting

### Tests fail with "Port already in use"

Make sure no server is running on port 5000:

```bash
killall node-drive 2>/dev/null
```

### Browser not found

Install Playwright browsers:

```bash
pnpm exec playwright install
```

### Timeout errors

Increase timeout in test or playwright config. VPS tests automatically use longer timeouts.

## Writing New Tests

Follow these patterns:

1. **Use temp files**: Create test files in a temp directory
2. **Clean up**: Use `beforeAll`/`afterAll` hooks for setup/cleanup
3. **Use precise selectors**: Target elements with specific locators
4. **Wait for state**: Always wait for elements/modals before interacting
5. **Verify changes**: Check both UI state and expected outcomes

Example:

```typescript
test('should upload file', async ({ page }) => {
  const testFile = path.join(testDir, 'test.txt');

  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles(testFile);

  await page.locator('button:has-text("Upload")').click();
  await page.waitForTimeout(1000);

  await expect(page.locator('text=test.txt')).toBeVisible();
});
```
