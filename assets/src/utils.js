// @ts-check
export { autorun, toJS } from "https://esm.sh/mobx@6.15.0";
import { observable } from "https://esm.sh/mobx@6.15.0";

export const store = observable({
  uploadQueue: [],
});

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
