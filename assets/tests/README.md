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

## Test Suites

### 1. Upload Tests (`upload.spec.ts`)

- Single file upload
- Multiple file upload
- Upload progress indication

### 2. Folder Operations (`folder.spec.ts`)

- Create new folder
- Navigate into folders
- Breadcrumb navigation
- Delete empty folders

### 3. File Operations (`file-operations.spec.ts`)

- View file in browser
- Download file
- Delete file
- Move/rename file
- Display file size
- Display modification time

### 4. Navigation Tests (`navigation.spec.ts`)

- Home page load
- Breadcrumb display
- Browser back/forward navigation
- URL updates on directory changes
- Content refresh on navigation

### 5. Provenance Tests (`provenance.spec.ts`)

- Display verification badges
- Open provenance modal
- Loading states
- Folder vs file verification
- Download manifest JSON
- Hash display

## Test Configuration

The tests are configured to:

- Run against `http://127.0.0.1:5000`
- Auto-start the Rust server before tests
- Run sequentially to avoid file operation conflicts
- Capture screenshots on failure
- Generate HTML reports

## Prerequisites

Before running tests, ensure:

1. The Rust project builds successfully: `cargo build`
2. The frontend builds successfully: `pnpm build`
3. Port 5000 is available

## CI/CD Integration

To run in CI environments:

```bash
CI=true pnpm test
```

This enables:
- Retries on flaky tests
- Stricter error handling
- HTML report generation

## Troubleshooting

### Tests fail with "Port already in use"

Make sure no server is running on port 5000:

```bash
lsof -ti:5000 | xargs kill -9
```

### Browser not found

Install Playwright browsers:

```bash
pnpm exec playwright install
```

### Timeout errors

Increase timeout in `playwright.config.ts`:

```typescript
use: {
  timeout: 30000, // 30 seconds
}
```

## Writing New Tests

Follow these patterns:

1. **Use unique identifiers**: Generate unique names with timestamps to avoid conflicts
2. **Clean up after tests**: Use `afterEach` hooks to delete test files/folders
3. **Handle dialogs**: Use `page.once('dialog', ...)` for prompts and confirms
4. **Wait for actions**: Always wait for elements/navigation after actions
5. **Verify state**: Check both UI changes and backend state

Example:

```typescript
test('should do something', async ({ page }) => {
  const testName = `test-${Date.now()}`;

  try {
    // Test code here

  } finally {
    // Cleanup code here
  }
});
```
