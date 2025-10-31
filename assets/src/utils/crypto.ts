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
