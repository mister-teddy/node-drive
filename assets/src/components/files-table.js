// @ts-check

import {
  useState,
  useEffect,
  createElement,
} from "../esm-imports.js";
import { formatMtime, formatFileSize, formatDirSize, encodedStr, formatHashShort, copyToClipboard } from "../utils.js";

/**
 * @typedef {Object} PathItem
 * @property {"Dir"|"SymlinkDir"|"File"|"SymlinkFile"} path_type
 * @property {string} name
 * @property {number} mtime
 * @property {number} size
 * @property {string} [sha256] - SHA-256 hash of the file
 * @property {Object} [provenance] - Provenance data
 * @property {Array<Object>} [provenance.events] - Array of provenance events
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
  const [expandedSignatures, setExpandedSignatures] = useState(new Set());
  const [copiedHash, setCopiedHash] = useState(null);

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
   * @param {string} hash
   * @param {number} index
   */
  const toggleSignatureExpanded = (hash, index) => {
    const newExpanded = new Set(expandedSignatures);
    const key = `${index}-${hash}`;
    if (newExpanded.has(key)) {
      newExpanded.delete(key);
    } else {
      newExpanded.add(key);
    }
    setExpandedSignatures(newExpanded);
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
   * @typedef {Object} ProvenanceEvent
   * @property {string} type
   * @property {string} timestamp
   * @property {string} actor
   * @property {string} signature
   * @property {string} ots_proof
   * @property {string|null} previous_hash
   */

  /**
   * @typedef {Object} ProvenanceManifest
   * @property {string} manifest_version
   * @property {Object} artifact
   * @property {ProvenanceEvent[]} events
   */

  /**
   * @param {PathItem} file
   * @returns {ProvenanceManifest|null}
   */
  const getMockProvenanceData = (file) => {
    // Mock provenance data for demo - in production this would come from the server
    if (file.sha256) {
      return {
        manifest_version: "provenance.manifest/v1",
        artifact: {
          name: file.name,
          sha256: file.sha256,
          size: file.size,
        },
        events: [
          {
            type: "mint",
            timestamp: new Date(file.mtime * 1000).toISOString(),
            actor: DATA.user || "anonymous",
            signature: "ed25519:3045022100...",
            ots_proof: "AE07..." + file.sha256.slice(0, 32),
            previous_hash: null,
          },
          {
            type: "transfer",
            timestamp: new Date(file.mtime * 1000 + 3600000).toISOString(),
            actor: "alice@example.com",
            signature: "ed25519:3046022100...",
            ots_proof: "AE08..." + file.sha256.slice(0, 32),
            previous_hash: file.sha256.slice(0, 16) + "...",
          },
        ],
      };
    }
    return null;
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
        const hash = file.sha256 || "";
        const shortHash = formatHashShort(hash);
        const isExpanded = expandedSignatures.has(`${index}-${hash}`);
        const provenance = getMockProvenanceData(file);

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
            // Digital Signature
            createElement(
              "div",
              {
                style: {
                  display: "flex",
                  alignItems: "center",
                  gap: "4px",
                },
              },
              hash
                ? createElement(
                  "button",
                  {
                    onClick: () => toggleSignatureExpanded(hash, index),
                    style: {
                      background: "none",
                      border: "1px solid #ddd",
                      color: "#0073e6",
                      cursor: "pointer",
                      fontSize: "11px",
                      fontFamily: "monospace",
                      padding: "4px 8px",
                      borderRadius: "3px",
                      backgroundColor: "#f5f5f5",
                    },
                  },
                  isExpanded ? "Hide" : shortHash,
                )
                : createElement(
                  "span",
                  { style: { color: "#999", fontSize: "11px" } },
                  "—",
                ),
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
          // Expanded ownership log
          isExpanded && provenance
            ? createElement(
              "div",
              {
                style: {
                  backgroundColor: "#f9f9f9",
                  padding: "16px",
                  marginLeft: "56px",
                  marginRight: "16px",
                  marginBottom: "12px",
                  borderRadius: "4px",
                  fontSize: "12px",
                  border: "1px solid #e0e0e0",
                },
              },
              // Title
              createElement(
                "div",
                {
                  style: {
                    fontWeight: "600",
                    color: "#333",
                    marginBottom: "12px",
                    fontSize: "13px",
                  },
                },
                "Ownership Log",
              ),
              // File fingerprint
              createElement(
                "div",
                {
                  style: {
                    marginBottom: "16px",
                    paddingBottom: "12px",
                    borderBottom: "1px solid #e0e0e0",
                  },
                },
                createElement(
                  "div",
                  {
                    style: {
                      color: "#666",
                      marginBottom: "4px",
                      fontSize: "11px",
                    },
                  },
                  "File Fingerprint (SHA-256):",
                ),
                createElement(
                  "div",
                  {
                    style: {
                      fontFamily: "monospace",
                      fontSize: "11px",
                      wordBreak: "break-all",
                      color: "#333",
                      marginBottom: "6px",
                    },
                  },
                  hash,
                ),
                createElement(
                  "button",
                  {
                    onClick: () => handleCopy(hash, hash),
                    style: {
                      background: "none",
                      border: "1px solid #ddd",
                      color: copiedHash === hash ? "#00C851" : "#666",
                      cursor: "pointer",
                      fontSize: "11px",
                      padding: "3px 8px",
                      borderRadius: "3px",
                    },
                  },
                  copiedHash === hash ? "Copied!" : "Copy Hash",
                ),
              ),
              // Events list
              createElement(
                "div",
                {
                  style: {
                    color: "#666",
                    marginBottom: "8px",
                    fontSize: "11px",
                    fontWeight: "600",
                  },
                },
                `Provenance Events (${provenance.events.length}):`,
              ),
              ...provenance.events.map((/** @type {any} */ event, /** @type {number} */ eventIndex) =>
                createElement(
                  "div",
                  {
                    key: eventIndex,
                    style: {
                      backgroundColor: "#fff",
                      padding: "10px",
                      marginBottom: "8px",
                      borderRadius: "3px",
                      border: "1px solid #e0e0e0",
                    },
                  },
                  // Event type and timestamp
                  createElement(
                    "div",
                    {
                      style: {
                        display: "flex",
                        justifyContent: "space-between",
                        marginBottom: "6px",
                      },
                    },
                    createElement(
                      "span",
                      {
                        style: {
                          fontWeight: "600",
                          color: event.type === "mint" ? "#00C851" : "#0073e6",
                          textTransform: "uppercase",
                          fontSize: "10px",
                        },
                      },
                      event.type,
                    ),
                    createElement(
                      "span",
                      { style: { color: "#999", fontSize: "10px" } },
                      new Date(event.timestamp).toLocaleString(),
                    ),
                  ),
                  // Actor
                  createElement(
                    "div",
                    { style: { marginBottom: "4px" } },
                    createElement(
                      "span",
                      { style: { color: "#666" } },
                      "Actor: ",
                    ),
                    createElement(
                      "span",
                      { style: { color: "#333", fontWeight: "500" } },
                      event.actor,
                    ),
                  ),
                  // Signature
                  createElement(
                    "div",
                    {
                      style: {
                        marginBottom: "4px",
                        fontSize: "10px",
                      },
                    },
                    createElement(
                      "span",
                      { style: { color: "#666" } },
                      "Signature: ",
                    ),
                    createElement(
                      "span",
                      {
                        style: {
                          fontFamily: "monospace",
                          color: "#333",
                        },
                      },
                      event.signature,
                    ),
                  ),
                  // OTS Proof
                  createElement(
                    "div",
                    {
                      style: {
                        marginBottom: event.previous_hash ? "4px" : "0",
                        fontSize: "10px",
                      },
                    },
                    createElement(
                      "span",
                      { style: { color: "#666" } },
                      "OpenTimestamps Proof: ",
                    ),
                    createElement(
                      "span",
                      {
                        style: {
                          fontFamily: "monospace",
                          color: "#333",
                        },
                      },
                      event.ots_proof.slice(0, 24) + "...",
                    ),
                  ),
                  // Previous hash (if exists)
                  event.previous_hash
                    ? createElement(
                      "div",
                      { style: { fontSize: "10px" } },
                      createElement(
                        "span",
                        { style: { color: "#666" } },
                        "Previous Event Hash: ",
                      ),
                      createElement(
                        "span",
                        {
                          style: {
                            fontFamily: "monospace",
                            color: "#333",
                          },
                        },
                        event.previous_hash,
                      ),
                    )
                    : null,
                ),
              ),
              // JSON Manifest info
              createElement(
                "div",
                {
                  style: {
                    marginTop: "12px",
                    paddingTop: "12px",
                    borderTop: "1px solid #e0e0e0",
                    color: "#666",
                    fontSize: "11px",
                  },
                },
                createElement(
                  "div",
                  { style: { marginBottom: "4px" } },
                  `📄 Manifest Version: ${provenance.manifest_version}`,
                ),
                createElement(
                  "div",
                  null,
                  "This is a JSON manifest storing the file's fingerprint and an append-only list of signed events (mint, transfers), each with its own OpenTimestamps proof anchored to the Bitcoin blockchain.",
                ),
              ),
            )
            : null,
        );
      }),
    ),
  );
}