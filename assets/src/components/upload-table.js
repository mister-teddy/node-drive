// @ts-check

import { createElement } from "../esm-imports.js";
import { useStore } from "../utils.js";
import Provenance from "./provenance.js";

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
              status === "complete" ? createElement(Provenance, {
                fileName: fileName,
                defaultMode: "summary",
                isDir: false,
              }) : null,
            ),
          ),
        );
      }),
    ),
  );
}
