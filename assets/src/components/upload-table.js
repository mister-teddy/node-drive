// @ts-check

import { useState, createElement } from "../esm-imports.js";
import { formatHashShort, formatHashDisplay, copyToClipboard, useStore } from "../utils.js";

/**
 * @typedef {Object} DATA
 * @property {boolean} allow_upload
 */

/**
 * @param {{ DATA: DATA }} props
 */
export default function UploadTable({ DATA }) {
  const queue = useStore((store) => {
    const queueSnapshot = store?.uploadQueue.map((uploader) => ({
      name: uploader.name,
      file: uploader.file,
      status: uploader.status,
      statusReason: uploader.statusReason,
      progressValue: uploader.progressValue,
      progressText: uploader.text?.progress,
      speedText: uploader.text?.speed,
      durationText: uploader.text?.duration,
      sha256: uploader.sha256,
      timestamp: uploader.timestamp,
      bitcoinBlock: uploader.bitcoinBlock,
      bitcoinConfirmed: uploader.bitcoinConfirmed,
      // Computed properties (if needed)
      isComplete: uploader.isComplete,
      isUploading: uploader.isUploading,
      isFailed: uploader.isFailed,
      displayProgress: uploader.displayProgress
    }));
    return queueSnapshot;
  })
  const [expandedHashes, setExpandedHashes] = useState(new Set());
  const [copiedHash, setCopiedHash] = useState(null);
  console.log({ queue })


  /**
   * @param {number} bytes
   * @returns {string}
   */
  const formatFileSize = (bytes) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    const value = (bytes / Math.pow(k, i)).toFixed(1);
    return `${value} ${sizes[i]}`;
  };

  /**
   * @param {any} uploader
   * @returns {string}
   */
  const getStatus = (uploader) => {
    if (!uploader) return "Pending";
    return uploader.status || "Pending";
  };

  /**
   * @param {string} status
   * @returns {string}
   */
  const getStatusIcon = (status) => {
    switch (status) {
      case "complete":
        return "✓";
      case "failed":
        return "✗";
      case "uploading":
        return "↑";
      default:
        return "○";
    }
  };

  /**
   * @param {string} status
   * @returns {string}
   */
  const getStatusColor = (status) => {
    switch (status) {
      case "complete":
        return "#00C851";
      case "failed":
        return "#ff4444";
      case "uploading":
        return "#0073e6";
      default:
        return "#999";
    }
  };

  /**
   * @param {string} hash
   * @param {number} index
   */
  const toggleHashExpanded = (hash, index) => {
    const newExpanded = new Set(expandedHashes);
    const key = `${index}-${hash}`;
    if (newExpanded.has(key)) {
      newExpanded.delete(key);
    } else {
      newExpanded.add(key);
    }
    setExpandedHashes(newExpanded);
  };

  /**
   * @param {string} text
   * @param {string} hash
   */
  const handleCopy = async (text, hash) => {
    const success = await copyToClipboard(text);
    if (success) {
      setCopiedHash(hash);
      setTimeout(() => setCopiedHash(null), 2000);
    }
  };

  /**
   * @param {string} status
   * @returns {string}
   */
  const getVerificationStatus = (status) => {
    switch (status) {
      case "complete":
        return "✅ File not altered";
      case "uploading":
        return "🔄 Calculating fingerprint...";
      case "failed":
        return "❌ Upload failed";
      default:
        return "⏳ Pending verification";
    }
  };

  /**
   * @param {any} uploader
   * @returns {boolean}
   */
  const hasTimestamp = (uploader) => {
    // Check if timestamp exists and is complete
    return uploader?.timestamp && uploader.timestamp.status === "complete";
  };

  /**
   * @param {any} uploader
   * @returns {string}
   */
  const getBitcoinTimestamp = (uploader) => {
    if (uploader?.bitcoinBlock) {
      // If block info is available, use it
      const date = uploader.timestamp?.created
        ? new Date(uploader.timestamp.created)
        : new Date();
      const formatted =
        date.toLocaleDateString() +
        " " +
        date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      return `Verified on Bitcoin on ${formatted} (block ${uploader.bitcoinBlock})`;
    }
    // Fallback
    return "Verified on Bitcoin (block info pending)";
  };
  if (!DATA.allow_upload || !queue || queue.length === 0) {
    return null;
  }

  return createElement(
    "div",
    {
      style: {
        backgroundColor: "#fff",
        borderRadius: "8px",
        border: "1px solid #e0e0e0",
        margin: "16px 0",
        overflow: "hidden",
      },
    },
    createElement(
      "div",
      {
        style: {
          padding: "16px",
          borderBottom: "1px solid #f0f0f0",
          fontSize: "14px",
          fontWeight: "500",
          color: "#333",
        },
      },
      `Uploading ${queue.length} file${queue.length !== 1 ? 's' : ''}`,
    ),
    createElement(
      "div",
      { style: { maxHeight: "300px", overflowY: "auto" } },
      queue.map((item, index) => {
        const uploader = item;
        const status = getStatus(uploader);
        const statusIcon = getStatusIcon(status);
        const statusColor = getStatusColor(status);
        const hash = uploader?.sha256 || "";
        const shortHash = formatHashShort(hash);
        const isExpanded = expandedHashes.has(`${index}-${hash}`);
        const fileName = uploader?.name || uploader?.file?.name || "Unknown file";

        return createElement(
          "div",
          {
            key: uploader?.idx || index,
            style: {
              borderBottom: index < queue.length - 1 ? "1px solid #f8f8f8" : "none",
              fontSize: "14px",
            },
          },
          // Main file row
          createElement(
            "div",
            {
              style: {
                display: "flex",
                alignItems: "center",
                padding: "12px 16px",
              },
            },
            createElement(
              "div",
              {
                style: {
                  width: "24px",
                  height: "24px",
                  borderRadius: "50%",
                  backgroundColor: statusColor,
                  color: "white",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "12px",
                  fontWeight: "bold",
                  marginRight: "12px",
                  flexShrink: 0,
                },
              },
              statusIcon,
            ),
            createElement(
              "div",
              { style: { flex: 1, minWidth: 0 } },
              // File name
              createElement(
                "div",
                {
                  style: {
                    fontWeight: "500",
                    color: "#333",
                    marginBottom: "4px",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  },
                },
                fileName,
              ),
              // File size and status
              createElement(
                "div",
                {
                  style: {
                    fontSize: "12px",
                    color: "#666",
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    marginBottom: "4px",
                  },
                },
                formatFileSize(uploader?.file?.size || 0),
                uploader?.progressText && uploader.progressText !== status
                  ? createElement(
                    "span",
                    { style: { color: statusColor } },
                    `• ${uploader.progressText}`,
                  )
                  : null,
              ),
              // Digital fingerprint section
              hash ? createElement(
                "div",
                {
                  style: {
                    fontSize: "12px",
                    color: "#555",
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                  },
                },
                createElement(
                  "span",
                  {
                    style: {
                      color: "#666",
                      fontSize: "11px",
                    },
                  },
                  "Digital fingerprint:",
                ),
                createElement(
                  "button",
                  {
                    onClick: () => toggleHashExpanded(hash, index),
                    style: {
                      background: "none",
                      border: "none",
                      color: "#0073e6",
                      cursor: "pointer",
                      fontSize: "12px",
                      fontFamily: "monospace",
                      padding: "2px 4px",
                      borderRadius: "3px",
                      backgroundColor: "#f5f5f5",
                    },
                  },
                  isExpanded ? formatHashDisplay(hash) : shortHash,
                ),
                isExpanded ? createElement(
                  "button",
                  {
                    onClick: () => handleCopy(hash, hash),
                    style: {
                      background: "none",
                      border: "1px solid #ddd",
                      color: copiedHash === hash ? "#00C851" : "#666",
                      cursor: "pointer",
                      fontSize: "11px",
                      padding: "2px 6px",
                      borderRadius: "3px",
                    },
                  },
                  copiedHash === hash ? "Copied!" : "Copy",
                ) : null,
              ) : null,
            ),
          ),
          // Expanded verification details
          status === "complete" && hash && isExpanded ? createElement(
            "div",
            {
              style: {
                backgroundColor: "#f9f9f9",
                padding: "12px 16px",
                marginLeft: "36px",
                borderRadius: "4px",
                fontSize: "12px",
              },
            },
            // User-friendly side
            createElement(
              "div",
              {
                style: {
                  marginBottom: "12px",
                  paddingBottom: "12px",
                  borderBottom: "1px solid #e0e0e0",
                },
              },
              createElement(
                "div",
                {
                  style: {
                    fontWeight: "500",
                    color: "#333",
                    marginBottom: "6px",
                  },
                },
                "Verification Status",
              ),
              createElement(
                "div",
                {
                  style: {
                    color: statusColor,
                    marginBottom: "4px",
                  },
                },
                `${getVerificationStatus(status)}: ${shortHash}`,
              ),
              hasTimestamp(uploader) ? createElement(
                "div",
                {
                  style: {
                    color: "#00C851",
                    marginBottom: "4px",
                  },
                },
                "✅ File verified by me",
              ) : null,
              hasTimestamp(uploader) ? createElement(
                "div",
                {
                  style: {
                    color: "#00C851",
                  },
                },
                `✅ ${getBitcoinTimestamp(uploader)}`,
              ) : null,
            ),
            // Cryptographic details side
            createElement(
              "div",
              null,
              createElement(
                "div",
                {
                  style: {
                    fontWeight: "500",
                    color: "#333",
                    marginBottom: "6px",
                  },
                },
                "Cryptographic Details",
              ),
              createElement(
                "div",
                {
                  style: {
                    marginBottom: "4px",
                  },
                },
                createElement(
                  "span",
                  {
                    style: {
                      color: "#666",
                      display: "block",
                      marginBottom: "2px",
                    },
                  },
                  "SHA-256 hash:",
                ),
                createElement(
                  "span",
                  {
                    style: {
                      fontFamily: "monospace",
                      fontSize: "11px",
                      wordBreak: "break-all",
                      color: "#333",
                    },
                  },
                  hash,
                ),
              ),
              hasTimestamp(uploader) ? createElement(
                "div",
                {
                  style: {
                    marginTop: "8px",
                  },
                },
                createElement(
                  "span",
                  {
                    style: {
                      color: "#666",
                      display: "block",
                      marginBottom: "2px",
                    },
                  },
                  "Timeproof OpenTimestamps / anchored in Bitcoin",
                ),
                createElement(
                  "span",
                  {
                    style: {
                      color: "#666",
                      display: "block",
                      marginBottom: "2px",
                    },
                  },
                  uploader.bitcoinBlock
                    ? `block #${uploader.bitcoinBlock}:`
                    : "block: (pending)",
                ),
                createElement(
                  "span",
                  {
                    style: {
                      fontFamily: "monospace",
                      fontSize: "11px",
                      color: "#333",
                    },
                  },
                  formatHashDisplay(hash),
                ),
              ) : null,
            ),
          ) : null,
        );
      }),
    ),
  );
}
