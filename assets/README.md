# Assets Build System

This directory contains the frontend assets for Node Drive, built with Vite and React/TypeScript.

## Structure

````
assets/
├── src/                    # Source TypeScript/TSX files
│   ├── main.tsx           # Main entry point
│   ├── main.css           # Main CSS (imports index.css)
│   ├── utils.ts           # Utility functions
│   └── components/        # React components
│       ├── files-table.tsx
│       ├── file-preview-drawer.tsx
│       └── provenance.tsx
├── tests/                 # E2E tests with Playwright
│   ├── upload.spec.ts
│   ├── folder.spec.ts
│   ├── file-operations.spec.ts
│   ├── navigation.spec.ts
│   ├── provenance.spec.ts
│   └── README.md
├── index.html             # HTML template
├── index.js               # Built JavaScript (generated)
├── index.css              # Built CSS (generated)
├── package.json           # Dependencies and scripts
├── tsconfig.json          # TypeScript configuration
└── vite.config.ts         # Vite build configuration

## Development

### Install Dependencies

```bash
cd assets
npm install
````

### Development Server

Run a development server with hot module replacement:

```bash
npm run dev
```

This will start Vite's dev server at `http://localhost:5173` (or another port if 5173 is taken).

### Build for Production

Compile TypeScript and bundle for production:

```bash
npm run build
```

This will:

1. Run TypeScript compiler to check types
2. Bundle all TSX/TS files into `index.js`
3. Process and minify CSS into `index.css`

The build outputs directly to the `assets/` directory (not a `dist/` subdirectory).

### Preview Production Build

Preview the production build locally:

```bash
npm run preview
```

## Architecture

### TypeScript Migration

The codebase has been converted from vanilla JavaScript with JSDoc types to proper TypeScript:

- **Before**: Used ESM imports from CDN URLs (`esm.sh`)
- **After**: Uses npm packages managed through `package.json`
- **React**: Now uses proper JSX/TSX instead of `createElement` calls
- **Type Safety**: Full TypeScript type checking at build time

### Key Components

1. **main.tsx**: Entry point that initializes React components, handles Uppy file uploads, authentication, breadcrumbs, and editor setup.

2. **files-table.tsx**: React component that renders the file/directory listing table with provenance information, delete/move actions.

3. **provenance.tsx**: Component that displays digital provenance stamps (OpenTimestamps verification) with expandable details.

4. **utils.ts**: Utility functions for SHA-256 hashing, file size formatting, date formatting, clipboard operations.

## Dependencies

### Core Dependencies

- `react@18.3.1` - React library
- `react-dom@18.3.1` - React DOM renderer
- `jotai@2.15.0` - State management library

### Dev Dependencies

- `vite@6.0.7` - Build tool and dev server
- `typescript@5.7.2` - TypeScript compiler
- `@vitejs/plugin-react@4.3.4` - Vite plugin for React support
- `@types/react` & `@types/react-dom` - TypeScript type definitions
- `@playwright/test@1.56.1` - End-to-end testing framework
- `playwright@1.56.1` - Browser automation

## Features

### File Preview Drawer

The application includes a modern file preview drawer (similar to Dropbox) that allows users to preview files without leaving the current page.

**Supported file types:**

- 📸 **Images:** jpg, jpeg, png, gif, svg, webp, bmp, ico (with zoom)
- 📄 **PDFs:** Inline preview with native browser controls
- 📝 **Text/Code:** txt, md, json, xml, yaml, js, ts, py, go, rs, and more
- 🎥 **Videos:** mp4, webm, ogg, mov (with playback controls)
- 🎵 **Audio:** mp3, wav, ogg, m4a, flac (with playback controls)

**Usage:** Click any file in the file table to open the preview drawer. The drawer includes:

- File preview (if supported)
- Download button
- "Open in New Tab" option
- Close with Escape key or click outside

See `DRAWER_FEATURE.md` for complete documentation.

## Testing

The project includes comprehensive end-to-end tests using Playwright.

### Run Tests

```bash
# Install Playwright browsers (one-time)
pnpm exec playwright install

# Run all tests
pnpm test

# Run with UI mode (recommended)
pnpm test:ui

# Run in headed mode (see browser)
pnpm test:headed

# View test report
pnpm test:report
```

**Test Coverage:**

- ✅ File upload (single, multiple, large files)
- ✅ Folder operations (create, navigate, delete)
- ✅ File operations (view, download, delete, move)
- ✅ Navigation (breadcrumbs, back/forward, URL updates)
- ✅ Provenance features (badges, modals, verification)
- ✅ File preview drawer (all supported types)

See `tests/README.md` for detailed testing documentation.

## Build Configuration

### Vite Config (`vite.config.ts`)

The Vite configuration is set up to:

- Output directly to `assets/` directory (not `dist/`)
- Generate `index.js` and `index.css` (matching the original file names)
- Not empty the output directory (preserves `index.html` and other static assets)
- Bundle with optimal code splitting

### TypeScript Config (`tsconfig.json`)

Configured for:

- ES2020 target with modern JavaScript features
- Strict type checking enabled
- JSX transformation using React 18's automatic runtime
- Bundler module resolution for Vite compatibility

## Integration with Rust Server

The Rust server in `src/server.rs` serves these assets:

- `dist/*` is served at runtime as static assets
- The server embeds these files at compile time using `include_str!()` and `include_bytes!()`

When you rebuild the assets with `npm run build`, you must also rebuild the Rust server for changes to take effect:

```bash
# In the assets/ directory
npm run build

# In the project root
cargo build --release
```

## Notes

- The build process preserves the existing `index.html` structure with template placeholders
- All external CDN dependencies (Uppy, OpenTimestamps) remain as CDN imports in `index.html`
- The Vite build only bundles the application's own React/TypeScript code
- Source maps are generated in development mode but stripped in production builds
