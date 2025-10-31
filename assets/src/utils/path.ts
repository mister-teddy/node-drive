/**
 * Get current path for API requests (with /api prefix)
 */
export function apiPath(relativePath: string = ""): string {
  const currentPath = location.pathname;
  let basePath = currentPath;

  // Build the full path
  if (relativePath) {
    if (!basePath.endsWith("/")) basePath += "/";
    basePath += relativePath.split("/").map(encodeURIComponent).join("/");
  }

  return "/api" + basePath;
}

/**
 * Get current path for direct file access (without /api prefix, for downloads)
 */
export function filePath(relativePath: string = ""): string {
  const currentPath = location.pathname;
  let basePath = currentPath;

  // Build the full path
  if (relativePath) {
    if (!basePath.endsWith("/")) basePath += "/";
    basePath += relativePath.split("/").map(encodeURIComponent).join("/");
  }

  return basePath;
}
