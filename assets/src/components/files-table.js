// @ts-check

import {
  useState,
  useEffect,
  createElement,
} from "../esm-imports.js";
import { formatMtime, formatFileSize, formatDirSize, encodedStr } from "../utils.js";
import Provenance from "./provenance.js";

/**
 * @typedef {Object} PathItem
 * @property {"Dir"|"SymlinkDir"|"File"|"SymlinkFile"} path_type
 * @property {string} name
 * @property {number} mtime
 * @property {number} size
 * @property {string} [sha256] - SHA-256 hash of the file
 * @property {Object} [provenance] - Provenance data
 * @property {Array<Object>} [provenance.events] - Array of provenance events
 * @property {{success: boolean, results?: {bitcoin: {timestamp: number, height: number}}, error?: string, sha256_hex?: string}} [stamp_status] - OTS verification status
 */

/**
 * @typedef {Object} DATA
 * @property {PathItem[]} paths
 * @property {boolean} allow_upload
 * @property {boolean} allow_delete
 * @property {boolean} allow_archive
 * @property {string} user
 * @property {string} [uri_prefix]
 */

/**
 * @param {{ DATA: DATA }} props
 */
export default function FilesTable({ DATA }) {
  const [paths, setPaths] = useState(DATA.paths || []);

  useEffect(() => {
    // Update paths when DATA changes
    setPaths(DATA.paths || []);
  }, [DATA.paths]);

  /**
   * @param {string} name
   * @returns {string}
   */
  const newUrl = (name) => {
    const href = window.location.href.split("?")[0];
    if (!href.endsWith("/")) {
      return href + "/" + encodeURIComponent(name);
    }
    return href + encodeURIComponent(name);
  };


  /**
   * @param {string} path_type
   * @returns {string}
   */
  const getPathIcon = (path_type) => {
    /** @type {Record<string, string>} */
    const icons = {
      Dir: `<svg height="16" viewBox="0 0 14 16" width="14"><path fill-rule="evenodd" d="M13 4H7V3c0-.66-.31-1-1-1H1c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1V5c0-.55-.45-1-1-1zM6 4H1V3h5v1z"></path></svg>`,
      SymlinkFile: `<svg height="16" viewBox="0 0 12 16" width="12"><path fill-rule="evenodd" d="M8.5 1H1c-.55 0-1 .45-1 1v12c0 .55.45 1 1 1h10c.55 0 1-.45 1-1V4.5L8.5 1zM11 14H1V2h7l3 3v9zM6 4.5l4 3-4 3v-2c-.98-.02-1.84.22-2.55.7-.71.48-1.19 1.25-1.45 2.3.02-1.64.39-2.88 1.13-3.73.73-.84 1.69-1.27 2.88-1.27v-2H6z"></path></svg>`,
      SymlinkDir: `<svg height="16" viewBox="0 0 14 16" width="14"><path fill-rule="evenodd" d="M13 4H7V3c0-.66-.31-1-1-1H1c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1V5c0-.55-.45-1-1-1zM1 3h5v1H1V3zm6 9v-2c-.98-.02-1.84.22-2.55.7-.71.48-1.19 1.25-1.45 2.3.02-1.64.39-2.88 1.13-3.73C4.86 8.43 5.82 8 7.01 8V6l4 3-4 3H7z"></path></svg>`,
      File: `<svg height="16" viewBox="0 0 12 16" width="12"><path fill-rule="evenodd" d="M6 5H2V4h4v1zM2 8h7V7H2v1zm0 2h7V9H2v1zm0 2h7v-1H2v1zm10-7.5V14c0 .55-.45 1-1 1H1c-.55 0-1-.45-1-1V2c0-.55.45-1 1-1h7.5L12 4.5zM11 5L8 2H1v12h10V5z"></path></svg>`,
    };
    return icons[path_type] || icons["File"];
  };

  /**
   * Render verification stamps for a file
   * @param {PathItem} file
   * @returns {import("../esm-imports.js").ReactElement | null}
   */
  const renderVerificationStamps = (file) => {
    return createElement(Provenance, {
      fileName: file.name,
      defaultMode: "summary",
      isDir: false,
      stampStatus: file.stamp_status,
    });
  };

  /**
   * @param {number} index
   */
  const handleDelete = async (index) => {
    const file = paths[index];
    if (!file) return;

    if (!confirm(`Delete \`${file.name}\`?`)) return;

    try {
      const url = newUrl(file.name);
      const res = await fetch(url, {
        method: "DELETE",
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      // Update local state
      const newPaths = [...paths];
      newPaths.splice(index, 1);
      setPaths(newPaths);
    } catch (err) {
      const error = /** @type {Error} */ (err);
      alert(`Cannot delete \`${file.name}\`, ${error.message}`);
    }
  };

  /**
   * @param {number} index
   */
  const handleMove = async (index) => {
    const file = paths[index];
    if (!file) return;

    const fileUrl = newUrl(file.name);
    const fileUrlObj = new URL(fileUrl);
    const prefix = DATA.uri_prefix?.slice(0, -1) || "";
    const filePath = decodeURIComponent(fileUrlObj.pathname.slice(prefix.length));

    let newPath = prompt("Enter new path", filePath);
    if (!newPath) return;
    if (!newPath.startsWith("/")) newPath = "/" + newPath;
    if (filePath === newPath) return;

    const newFileUrl =
      fileUrlObj.origin +
      prefix +
      newPath.split("/").map(encodeURIComponent).join("/");

    try {
      const res1 = await fetch(newFileUrl, {
        method: "HEAD",
      });
      if (res1.status === 200) {
        if (!confirm("Override existing file?")) {
          return;
        }
      }

      const res2 = await fetch(fileUrl, {
        method: "MOVE",
        headers: {
          Destination: newFileUrl,
        },
      });

      if (!res2.ok) {
        throw new Error(`HTTP ${res2.status}: ${res2.statusText}`);
      }

      // Reload to show updated paths
      location.reload();
    } catch (err) {
      const error = /** @type {Error} */ (err);
      alert(`Cannot move \`${filePath}\` to \`${newPath}\`, ${error.message}`);
    }
  };

  if (!paths || paths.length === 0) {
    return null;
  }

  // Add spinner animation CSS if not already present
  if (!document.getElementById("provenance-spinner-style")) {
    const style = document.createElement("style");
    style.id = "provenance-spinner-style";
    style.textContent = `
      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(style);
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
    // Table header
    createElement(
      "div",
      {
        style: {
          display: "grid",
          gridTemplateColumns: "40px 1fr 150px 100px 150px 120px",
          padding: "12px 16px",
          borderBottom: "1px solid #f0f0f0",
          fontSize: "13px",
          fontWeight: "600",
          color: "#333",
          backgroundColor: "#f9f9f9",
        },
      },
      createElement("div", null, ""),
      createElement("div", null, "Name"),
      createElement("div", null, "Last Modified"),
      createElement("div", null, "Size"),
      createElement("div", null, "Digital Signature"),
      createElement("div", null, "Actions"),
    ),
    // Table body
    createElement(
      "div",
      { style: { maxHeight: "600px", overflowY: "auto" } },
      paths.map((/** @type {PathItem} */ file, /** @type {number} */ index) => {
        const isDir = file.path_type.endsWith("Dir");
        const url = newUrl(file.name) + (isDir ? "/" : "");
        const encodedName = encodedStr(file.name);

        let sizeDisplay = isDir
          ? formatDirSize(file.size)
          : formatFileSize(file.size).join(" ");

        return createElement(
          "div",
          {
            key: index,
            style: {
              borderBottom: index < paths.length - 1 ? "1px solid #f8f8f8" : "none",
            },
          },
          // Main file row
          createElement(
            "div",
            {
              style: {
                display: "grid",
                gridTemplateColumns: "40px 1fr 150px 100px 150px 120px",
                padding: "12px 16px",
                fontSize: "13px",
                alignItems: "center",
              },
            },
            // Icon
            createElement("div", {
              dangerouslySetInnerHTML: { __html: getPathIcon(file.path_type) },
            }),
            // Name
            createElement(
              "div",
              {
                style: {
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                },
              },
              createElement(
                "a",
                {
                  href: url,
                  target: isDir ? undefined : "_blank",
                  style: { color: "#0073e6", textDecoration: "none" },
                },
                encodedName,
              ),
            ),
            // Modified time
            createElement(
              "div",
              { style: { color: "#666", fontSize: "12px" } },
              formatMtime(file.mtime),
            ),
            // Size
            createElement(
              "div",
              { style: { color: "#666", fontSize: "12px" } },
              sizeDisplay,
            ),
            // Digital Signature - show verification stamps
            createElement(
              "div",
              null,
              isDir ? createElement("span", { style: { color: "#999", fontSize: "11px" } }, "—") : renderVerificationStamps(file),
            ),
            // Actions
            createElement(
              "div",
              {
                style: {
                  display: "flex",
                  gap: "8px",
                  alignItems: "center",
                },
              },
              // Download
              createElement(
                "a",
                {
                  href: url + (isDir && DATA.allow_archive ? "?zip" : ""),
                  download: true,
                  title: isDir ? "Download folder as zip" : "Download file",
                  style: {
                    color: "#666",
                    cursor: "pointer",
                    display: "flex",
                  },
                },
                "⬇",
              ),
              // Move
              DATA.allow_upload && DATA.allow_delete
                ? createElement(
                  "button",
                  {
                    onClick: () => handleMove(index),
                    title: "Move to new path",
                    style: {
                      background: "none",
                      border: "none",
                      color: "#666",
                      cursor: "pointer",
                      fontSize: "14px",
                      padding: "2px",
                    },
                  },
                  "➔",
                )
                : null,
              // Delete
              DATA.allow_delete
                ? createElement(
                  "button",
                  {
                    onClick: () => handleDelete(index),
                    title: "Delete",
                    style: {
                      background: "none",
                      border: "none",
                      color: "#ff4444",
                      cursor: "pointer",
                      fontSize: "14px",
                      padding: "2px",
                    },
                  },
                  "✗",
                )
                : null,
            ),
          ),
        );
      }),
    ),
  );
}