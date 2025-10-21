/**
 * Memory-efficient SHA256 calculation using FileReader for better handling of large files
 */
export async function calculateSHA256(
  file: File,
  progressCallback?: (progress: number) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunkSize = 64 * 1024; // 64KB chunks
    let position = 0;
    const chunks: Uint8Array[] = [];

    function readNextChunk() {
      if (position >= file.size) {
        // All chunks read, combine and hash
        combineAndHash();
        return;
      }

      const chunk = file.slice(position, position + chunkSize);
      const reader = new FileReader();

      reader.onload = function (e) {
        if (!e.target) {
          reject(new Error("FileReader event target is null"));
          return;
        }
        const result = e.target.result;
        if (!(result instanceof ArrayBuffer)) {
          reject(new Error("FileReader did not return an ArrayBuffer"));
          return;
        }
        chunks.push(new Uint8Array(result));
        position += chunkSize;

        // Progress callback
        if (progressCallback) {
          const progress = Math.min(position / file.size, 1);
          progressCallback(progress);
        }

        // Read next chunk
        readNextChunk();
      };

      reader.onerror = () => reject(new Error("Failed to read file chunk"));
      reader.readAsArrayBuffer(chunk);
    }

    async function combineAndHash() {
      try {
        // Combine all chunks
        const totalLength = chunks.reduce(
          (sum, chunk) => sum + chunk.length,
          0
        );
        const combined = new Uint8Array(totalLength);
        let offset = 0;

        for (const chunk of chunks) {
          combined.set(chunk, offset);
          offset += chunk.length;
        }

        // Calculate hash
        const hashBuffer = await crypto.subtle.digest("SHA-256", combined);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");

        resolve(hashHex);
      } catch (error) {
        reject(error);
      }
    }

    // Start reading
    readNextChunk();
  });
}

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

export function baseName(url: string): string {
  return decodeURIComponent(
    url
      .split("/")
      .filter((v) => v.length > 0)
      .slice(-1)[0]
  );
}

export function extName(filename: string): string {
  const dotIndex = filename.lastIndexOf(".");

  if (dotIndex === -1 || dotIndex === 0 || dotIndex === filename.length - 1) {
    return "";
  }

  return filename.substring(dotIndex);
}

export function formatMtime(mtime: number): string {
  if (!mtime) return "";
  const date = new Date(mtime);
  const year = date.getFullYear();
  const month = padZero(date.getMonth() + 1, 2);
  const day = padZero(date.getDate(), 2);
  const hours = padZero(date.getHours(), 2);
  const minutes = padZero(date.getMinutes(), 2);
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

export function padZero(value: number, size: number): string {
  return ("0".repeat(size) + value).slice(-1 * size);
}

export function formatDirSize(size: number): string {
  const MAX_SUBPATHS_COUNT = 1000;
  const unit = size === 1 ? "item" : "items";
  const num =
    size >= MAX_SUBPATHS_COUNT ? `>${MAX_SUBPATHS_COUNT - 1}` : `${size}`;
  return ` ${num} ${unit}`;
}

export function formatFileSize(size: number): [number, string] {
  if (size == null) return [0, "B"];
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  if (size == 0) return [0, "B"];
  const i = Math.floor(Math.log(size) / Math.log(1024));
  let ratio = 1;
  if (i >= 3) {
    ratio = 100;
  }
  return [
    Math.round(((size * ratio) / Math.pow(1024, i)) * 100) / 100 / ratio,
    sizes[i],
  ];
}

export function formatDuration(seconds: number): string {
  seconds = Math.ceil(seconds);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds - h * 3600) / 60);
  const s = seconds - h * 3600 - m * 60;
  return `${padZero(h, 2)}:${padZero(m, 2)}:${padZero(s, 2)}`;
}

export function formatPercent(percent: number): string {
  if (percent > 10) {
    return percent.toFixed(1) + "%";
  } else {
    return percent.toFixed(2) + "%";
  }
}

export function encodedStr(rawStr: string): string {
  return rawStr.replace(
    /[\u00A0-\u9999<>&]/g,
    (i) => "&#" + i.charCodeAt(0) + ";"
  );
}

export async function assertResOK(res: Response): Promise<void> {
  if (!(res.status >= 200 && res.status < 300)) {
    throw new Error((await res.text()) || `Invalid status ${res.status}`);
  }
}

export function getEncoding(contentType: string | null): string {
  const charset = contentType?.split(";")[1];
  if (charset && /charset/i.test(charset)) {
    let encoding = charset.split("=")[1];
    if (encoding) {
      return encoding.toLowerCase();
    }
  }
  return "utf-8";
}

export function decodeBase64(base64String: string): string {
  const binString = atob(base64String);
  const len = binString.length;
  const bytes = new Uint8Array(len);
  const arr = new Uint32Array(bytes.buffer, 0, Math.floor(len / 4));
  let i = 0;
  for (; i < arr.length; i++) {
    arr[i] =
      binString.charCodeAt(i * 4) |
      (binString.charCodeAt(i * 4 + 1) << 8) |
      (binString.charCodeAt(i * 4 + 2) << 16) |
      (binString.charCodeAt(i * 4 + 3) << 24);
  }
  for (i = i * 4; i < len; i++) {
    bytes[i] = binString.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

/**
 * Trigger download of a file with given filename and byte content
 */
export function download(filename: string, bytes: BlobPart): void {
  const blob = new Blob([bytes], { type: "octet/stream" });
  const link = document.createElement("a");
  link.href = window.URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export function hexToBytes(hex: string): number[] {
  const bytes: number[] = [];
  for (let c = 0; c < hex.length; c += 2) {
    bytes.push(parseInt(hex.substring(c, c + 2), 16));
  }
  return bytes;
}

/**
 * Create user-friendly hash representation
 */
export function formatHashShort(hash: string): string {
  if (!hash || hash.length < 6) return "------";
  return hash.substring(0, 6);
}

/**
 * Format full hash for display with copy functionality
 */
export function formatHashDisplay(hash: string): string {
  if (!hash || hash.length < 32) return hash || "----";
  return `${hash.substring(0, 30)}...`;
}

/**
 * Copy text to clipboard
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    // Fallback for older browsers
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = "fixed";
    textArea.style.left = "-9999px";
    document.body.appendChild(textArea);
    textArea.select();
    try {
      const success = document.execCommand("copy");
      return success;
    } catch (e) {
      return false;
    } finally {
      document.body.removeChild(textArea);
    }
  }
}


/**
 * Convert a string to an array of byte values
 */
export function string2Bin(str: string): number[] {
  const result: number[] = [];
  for (let i = 0; i < str.length; i++) {
    result.push(str.charCodeAt(i));
  }
  return result;
}

/**
 * Convert a base64 string to a Uint8Array
 */
export function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64); // decode base64 to binary string
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
