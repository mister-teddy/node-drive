// @ts-check
import { autorun, observable, useEffect, useState } from "./esm-imports.js";

/**
 * An object for storing application data.
 * @type {{uploadQueue: Array<import("./node-drive.js").Uploader>}}
 */
const storeData = {
  uploadQueue: [],
}

/**
 * An observable store initialized with the provided store data.
 * 
 * @type {typeof storeData}
 */
export const store = observable(storeData);

/**
 * Memory-efficient SHA256 calculation using FileReader for better handling of large files
 *
 * @param {File} file - The file to hash
 * @param {function} progressCallback - Optional callback function that receives progress (0-1)
 * @returns {Promise<string>} Promise that resolves to the SHA256 hash as hex string
 *
 * @example
 * // Usage with drag and drop
 * const dropZone = document.getElementById('dropzone');
 * dropZone.addEventListener('drop', async (event) => {
 *   event.preventDefault();
 *   const files = event.dataTransfer.files;
 *   if (files.length > 0) {
 *     const file = files[0];
 *     try {
 *       const hash = await calculateSHA256WithProgressStream(file, (progress) => {
 *         const percent = (progress * 100).toFixed(1);
 *         document.getElementById('status').textContent = `Hashing: ${percent}%`;
 *       });
 *       document.getElementById('result').textContent = `SHA256: ${hash}`;
 *     } catch (error) {
 *       document.getElementById('status').textContent = `Error: ${error.message}`;
 *     }
 *   }
 * });
 *
 * @example
 * // Integration with existing upload system
 * class Uploader {
 *   async uploadWithHash(file) {
 *     // Calculate hash before upload
 *     const hash = await calculateSHA256WithProgressStream(file, (progress) => {
 *       this.updateHashProgress(progress);
 *     });
 *
 *     // Include hash in upload metadata
 *     return this.upload(file, { sha256: hash });
 *   }
 * }
 */
export async function calculateSHA256(file, progressCallback) {
  return new Promise((resolve, reject) => {
    const chunkSize = 64 * 1024; // 64KB chunks
    let position = 0;
    /**
     * @type {Uint8Array<ArrayBuffer>[]}
     */
    const chunks = [];

    function readNextChunk() {
      if (position >= file.size) {
        // All chunks read, combine and hash
        combineAndHash();
        return;
      }

      const chunk = file.slice(position, position + chunkSize);
      const reader = new FileReader();

      reader.onload = function (e) {
        // Ensure e.target is not null and result is ArrayBuffer
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
          0,
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

export function baseUrl() {
  return location.href.split(/[?#]/)[0];
}

/**
 * Encodes a string to be safely included in a URL path segment
 * @param {string} name - The string to encode
 * @returns {string} The encoded string
 */
export function newUrl(name) {
  let url = baseUrl();
  if (!url.endsWith("/")) url += "/";
  url += name.split("/").map(encodeURIComponent).join("/");
  return url;
}

/**
 * @param {string} url
 * @returns {string}
 */
export function baseName(url) {
  return decodeURIComponent(
    url
      .split("/")
      .filter((v) => v.length > 0)
      .slice(-1)[0],
  );
}

/**
 * @param {string} filename
 * @returns {string}
 */
export function extName(filename) {
  const dotIndex = filename.lastIndexOf(".");

  if (dotIndex === -1 || dotIndex === 0 || dotIndex === filename.length - 1) {
    return "";
  }

  return filename.substring(dotIndex);
}

/**
 * @param {number} mtime
 * @returns {string}
 */
export function formatMtime(mtime) {
  if (!mtime) return "";
  const date = new Date(mtime);
  const year = date.getFullYear();
  const month = padZero(date.getMonth() + 1, 2);
  const day = padZero(date.getDate(), 2);
  const hours = padZero(date.getHours(), 2);
  const minutes = padZero(date.getMinutes(), 2);
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

/**
 * @param {number} value
 * @param {number} size
 * @returns {string}
 */
export function padZero(value, size) {
  return ("0".repeat(size) + value).slice(-1 * size);
}

/**
 * @param {number} size
 * @returns {string}
 */
export function formatDirSize(size) {
  const MAX_SUBPATHS_COUNT = 1000;
  const unit = size === 1 ? "item" : "items";
  const num =
    size >= MAX_SUBPATHS_COUNT ? `>${MAX_SUBPATHS_COUNT - 1}` : `${size}`;
  return ` ${num} ${unit}`;
}

/**
 * @param {number} size
 * @returns {[number, string]}
 */
export function formatFileSize(size) {
  if (size == null) return [0, "B"];
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  if (size == 0) return [0, "B"];
  const i = Math.floor(Math.log(size) / Math.log(1024));
  let ratio = 1;
  if (i >= 3) {
    ratio = 100;
  }
  return [Math.round((size * ratio) / Math.pow(1024, i) * 100) / 100 / ratio, sizes[i]];
}

/**
 * @param {number} seconds
 * @returns {string}
 */
export function formatDuration(seconds) {
  seconds = Math.ceil(seconds);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds - h * 3600) / 60);
  const s = seconds - h * 3600 - m * 60;
  return `${padZero(h, 2)}:${padZero(m, 2)}:${padZero(s, 2)}`;
}

/**
 * @param {number} percent
 * @returns {string}
 */
export function formatPercent(percent) {
  if (percent > 10) {
    return percent.toFixed(1) + "%";
  } else {
    return percent.toFixed(2) + "%";
  }
}

/**
 * @param {string} rawStr
 * @returns {string}
 */
export function encodedStr(rawStr) {
  return rawStr.replace(/[\u00A0-\u9999<>\&]/g, function (/** @type {string} */ i) {
    return "&#" + i.charCodeAt(0) + ";";
  });
}

/**
 * @param {Response} res
 * @returns {Promise<void>}
 */
export async function assertResOK(res) {
  if (!(res.status >= 200 && res.status < 300)) {
    throw new Error((await res.text()) || `Invalid status ${res.status}`);
  }
}

/**
 * @param {string | null} contentType
 * @returns {string}
 */
export function getEncoding(contentType) {
  const charset = contentType?.split(";")[1];
  if (charset && /charset/i.test(charset)) {
    let encoding = charset.split("=")[1];
    if (encoding) {
      return encoding.toLowerCase();
    }
  }
  return "utf-8";
}

/**
 * @param {string} base64String
 * @returns {string}
 */
export function decodeBase64(base64String) {
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
 * @param {string} filename - Name of the file to download
 * @param {BlobPart} bytes - Byte content of the file
 */
export function download(filename, bytes) {
  var blob = new Blob([bytes], { type: "octet/stream" });
  var link = document.createElement('a');
  link.href = window.URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export function hexToBytes(/** @type {string} */ hex) {
  const bytes = [];
  for (var c = 0; c < hex.length; c += 2) {
    bytes.push(parseInt(hex.substring(c, c + 2), 16));
  }
  return bytes;
};

/**
 * Create user-friendly hash representation
 * @param {string} hash - Full SHA256 hash
 * @returns {string} Short hash format like "abcdef"
 */
export function formatHashShort(hash) {
  if (!hash || hash.length < 6) return "------";
  return hash.substring(0, 6);
}

/**
 * Format full hash for display with copy functionality
 * @param {string} hash - Full SHA256 hash
 * @returns {string} Truncated hash for display
 */
export function formatHashDisplay(hash) {
  if (!hash || hash.length < 32) return hash || "----";
  return `${hash.substring(0, 30)}...`;
}

/**
 * Copy text to clipboard
 * @param {string} text - Text to copy
 * @returns {Promise<boolean>} Success status
 */
export async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    // Fallback for older browsers
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-9999px';
    document.body.appendChild(textArea);
    textArea.select();
    try {
      const success = document.execCommand('copy');
      return success;
    } catch (e) {
      return false;
    } finally {
      document.body.removeChild(textArea);
    }
  }
}
/**
 * React hook for subscribing to observable store changes using a selector function.
 *
 * @template T
 * @param {(store?: typeof storeData) => T} selector - Function to select a value from the store.
 * @returns {T} The selected value from the store, reactive to changes.
 */
export function useStore(selector) {
  const [data, setData] = useState(selector());

  useEffect(() => autorun(() => {
    setData(selector(store));
  }), []);

  return data;
}

/**
 * Convert a string to an array of byte values
 * @param {string} str - The input string
 * @returns {number[]} Array of byte values
 */
export function string2Bin(str) {
  var result = [];
  for (var i = 0; i < str.length; i++) {
    result.push(str.charCodeAt(i));
  }
  return result;
}

/**
 * Convert a base64 string to a Uint8Array
 * @param {string} base64 - The base64 encoded string
 * @returns {Uint8Array} The decoded byte array
 */
export function base64ToUint8Array(base64) {
  const binary = atob(base64); // decode base64 to binary string
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
