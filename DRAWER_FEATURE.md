# File Preview Drawer Feature

## Overview

Implemented a Dropbox-style file preview drawer that opens when clicking on files, replacing the previous "open in new tab" behavior. This provides a seamless, in-app preview experience for various file types.

## Implementation Details

### New Component: `FilePreviewDrawer`

**Location:** `/assets/src/components/file-preview-drawer.tsx`

**Features:**
- ✅ **Responsive width:** 80% of viewport width, max 1000px
- ✅ **File type detection:** Based on file extension
- ✅ **Download button:** Always available in drawer header
- ✅ **Open in new tab button:** For users who prefer external viewing
- ✅ **Loading states:** Shows spinner while fetching content
- ✅ **Error handling:** Graceful degradation for unsupported types

### Supported File Types

#### 📸 **Images** (with zoom)
- jpg, jpeg, png, gif, svg, webp, bmp, ico
- Full Ant Design Image component with zoom/preview
- Displays at max 70vh height for optimal viewing

#### 📄 **PDF Files**
- Embedded iframe preview
- Full scrolling support
- Native browser PDF controls

#### 📝 **Text Files** (with syntax highlighting-ready)
- txt, md, markdown, json, xml, yaml, yml, log
- js, jsx, ts, tsx, css, scss, html
- py, java, c, cpp, h, go, rs
- sh, bash, toml, ini, conf
- Monospace font, wrapped in `<pre>` tag
- Scrollable with max 70vh height

#### 🎥 **Video Files**
- mp4, webm, ogg, mov
- Native HTML5 video player with controls
- Responsive sizing

#### 🎵 **Audio Files**
- mp3, wav, ogg, m4a, flac
- Native HTML5 audio player with controls
- Centered with file icon display

#### ❓ **Unsupported Types**
- Shows file icon and type
- "Preview not available" message
- Prominent download button

## User Experience Flow

### Before (Old Behavior)
```
User clicks file → Opens in new tab → User switches tabs
```

### After (New Behavior)
```
User clicks file → Drawer slides in from right →
Preview shown immediately → User can download/open in new tab if needed
```

## Component Integration

### Changes to `FilesTable` Component

**Location:** `/assets/src/components/files-table.tsx`

**Changes:**
1. Added state management:
   ```typescript
   const [previewFile, setPreviewFile] = useState<string | null>(null);
   const [isDrawerOpen, setIsDrawerOpen] = useState(false);
   ```

2. Added click handler:
   ```typescript
   const handleFileClick = (file: PathItem) => {
     setPreviewFile(file.name);
     setIsDrawerOpen(true);
   };
   ```

3. Replaced `<a>` tag with click handler:
   ```typescript
   // Old: <a href={path} target="_blank" rel="noopener noreferrer">
   // New: <a onClick={(e) => { e.preventDefault(); handleFileClick(file); }}>
   ```

4. Added drawer at component bottom:
   ```typescript
   <FilePreviewDrawer
     open={isDrawerOpen}
     fileName={previewFile}
     onClose={handleDrawerClose}
   />
   ```

## Testing

### Updated Tests

**Location:** `/assets/tests/file-operations.spec.ts`

**Changes:**
1. ✅ Updated "view file" test to check for drawer instead of new tab
2. ✅ Added test for "Open in New Tab" button within drawer
3. ✅ Added test for text file content preview
4. ✅ Added test for download button visibility

**New Tests:**
- `should view a file in drawer` - Verifies drawer opens on file click
- `should open file in new tab from drawer` - Tests drawer's "Open in New Tab" button
- `should preview text file content in drawer` - Validates content rendering
- `should show download button in drawer for all files` - Ensures download always available

**Total File Operation Tests:** Now 10 tests (was 6)

## UI/UX Benefits

### 1. **Faster Preview**
- No context switching between tabs
- Immediate visual feedback
- Stays on same page/directory

### 2. **Better Mobile Experience**
- Drawer slides smoothly on mobile
- No new tab management issues
- Touch-friendly close gestures

### 3. **Consistent Navigation**
- User stays in the file browser
- Easy to preview multiple files sequentially
- Breadcrumb/navigation remains visible

### 4. **Flexible Actions**
- Quick preview without commitment
- Download directly from drawer
- Option to still open in new tab if needed
- Close with Escape key or click outside

### 5. **Professional Look**
- Matches modern file management UIs (Dropbox, Google Drive)
- Smooth animations
- Proper loading states

## Technical Details

### Drawer Configuration

```typescript
<Drawer
  width={Math.min(window.innerWidth * 0.8, 1000)}  // Responsive
  placement="right"                                  // Slides from right
  closeIcon={<CloseOutlined />}                     // Clear close button
  extra={<Space>...</Space>}                        // Action buttons
/>
```

### Performance Considerations

1. **Lazy Loading:** Content only fetched when drawer opens
2. **Conditional Rendering:** Only one drawer instance, reused
3. **Cleanup:** State cleared on close
4. **Optimized Previews:** Images use Ant Design's optimized Image component

### Accessibility

- ✅ Keyboard navigation (Escape to close)
- ✅ Focus management
- ✅ Screen reader friendly
- ✅ Clear visual hierarchy
- ✅ Touch-friendly tap targets

## Future Enhancements

### Potential Additions:

1. **Code Syntax Highlighting:**
   - Add `prism.js` or `highlight.js`
   - Syntax coloring for code files
   - Line numbers

2. **Document Preview:**
   - Add support for .docx, .xlsx (using libraries)
   - Markdown rendering with proper styling
   - CSV table rendering

3. **Navigation Controls:**
   - Next/Previous file buttons
   - Keyboard shortcuts (arrow keys)
   - Slide animation between files

4. **Edit in Place:**
   - For text files, add edit button
   - Inline editor in drawer
   - Save changes directly

5. **Metadata Display:**
   - File size, modified date in drawer
   - Provenance info in drawer
   - Sharing options

6. **Performance:**
   - Cache previously viewed files
   - Preload next file on hover
   - Lazy load large images

## Migration Notes

### Breaking Changes
- None. All existing functionality preserved.
- "Open in New Tab" still available via button in drawer

### Backwards Compatibility
- Download button still works
- All file operations (delete, move) unchanged
- Tests updated to reflect new behavior

## Files Modified

1. `/assets/src/components/file-preview-drawer.tsx` - **NEW** (270 lines)
2. `/assets/src/components/files-table.tsx` - Modified (323 lines)
3. `/assets/tests/file-operations.spec.ts` - Updated tests

## Build Output

```bash
dist/index.js    1,388.79 kB │ gzip: 438.58 kB
```
Bundle size increased by ~47KB (from 1,341KB to 1,388KB) - acceptable for the rich preview functionality added.

## Usage

No configuration needed. The feature is automatically active:

1. Click any file in the file table
2. Drawer slides in from right
3. File preview shown (if supported) or download option
4. Click outside, press Escape, or use close button to dismiss

## Summary

The file preview drawer provides a modern, Dropbox-like experience for viewing files without leaving the application. It supports 20+ file types with appropriate previews, maintains all existing functionality, and improves the overall user experience significantly.

**Result:** A more professional, user-friendly file browsing experience. ✨
