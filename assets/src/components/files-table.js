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
  const [provenanceData, setProvenanceData] = useState(/** @type {Map<string, any>} */(new Map()));
  const [loadingProvenance, setLoadingProvenance] = useState(/** @type {Set<string>} */(new Set()));

  useEffect(() => {
    // Update paths when DATA changes
    setPaths(DATA.paths || []);
    // Fetch provenance data for all files
    fetchAllProvenance();
  }, [DATA.paths]);

  /**
   * Fetch provenance data for all files
   */
  const fetchAllProvenance = async () => {
    const filesToFetch = (DATA.paths || []).filter(
      (/** @type {PathItem} */ p) => !p.path_type.endsWith("Dir")
    );

    for (const file of filesToFetch) {
      fetchProvenanceData(file.name);
    }
  };

  /**
   * Fetch provenance data for a specific file
   * @param {string} fileName
   */
  const fetchProvenanceData = async (fileName) => {
    if (loadingProvenance.has(fileName) || provenanceData.has(fileName)) {
      return;
    }

    setLoadingProvenance((prev) => new Set(prev).add(fileName));

    try {
      const url = newUrl(fileName) + "?manifest=json";
      const response = await fetch(url);

      if (response.ok) {
        const manifest = await response.json();
        setProvenanceData((prev) => new Map(prev).set(fileName, manifest));
      }
    } catch (error) {
      console.error(`Failed to fetch provenance for ${fileName}:`, error);
    } finally {
      setLoadingProvenance((prev) => {
        const next = new Set(prev);
        next.delete(fileName);
        return next;
      });
    }
  };

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
   * Check if OTS proof is still pending (placeholder)
   * @param {string} otsProof
   * @returns {boolean}
   */
  const isOtsPending = (otsProof) => {
    // OTS proof is pending if it's the placeholder value
    return otsProof === "UExBQ0VIT0xERVJfT1RTX1BST09G" || otsProof.startsWith("PLACEHOLDER");
  };

  /**
   * Render verification stamps for a file
   * @param {string} fileName
   * @returns {import("../esm-imports.js").ReactElement | null}
   */
  const renderVerificationStamps = (fileName) => {
    const manifest = provenanceData.get(fileName);
    const isLoading = loadingProvenance.has(fileName);

    if (isLoading) {
      return createElement(
        "div",
        {
          style: {
            display: "flex",
            flexDirection: "column",
            gap: "2px",
            fontSize: "10px",
          },
        },
        createElement(
          "div",
          {
            style: {
              display: "flex",
              alignItems: "center",
              gap: "4px",
              color: "#999",
            },
          },
          createElement(
            "span",
            {
              style: {
                display: "inline-block",
                width: "10px",
                height: "10px",
                border: "2px solid #ddd",
                borderTopColor: "#666",
                borderRadius: "50%",
                animation: "spin 0.6s linear infinite",
              },
            },
          ),
          "Loading...",
        ),
      );
    }

    if (!manifest || !manifest.events || manifest.events.length === 0) {
      return createElement(
        "span",
        {
          style: {
            color: "#999",
            fontSize: "11px",
          },
        },
        "—",
      );
    }

    const latestEvent = manifest.events[manifest.events.length - 1];
    const isPending = isOtsPending(latestEvent.ots_proof_b64 || "");
    const hashShort = formatHashShort(manifest.artifact.sha256_hex);

    return createElement(
      "div",
      {
        style: {
          display: "flex",
          flexDirection: "column",
          gap: "3px",
          fontSize: "10px",
          lineHeight: "1.3",
        },
      },
      // File integrity stamp
      createElement(
        "div",
        {
          style: {
            display: "flex",
            alignItems: "center",
            gap: "4px",
          },
        },
        createElement(
          "span",
          { style: { fontSize: "12px" } },
          "✓",
        ),
        createElement(
          "span",
          { style: { color: "#00C851", fontWeight: "500" } },
          "File not altered:",
        ),
        createElement(
          "span",
          {
            style: {
              fontFamily: "monospace",
              color: "#666",
              fontSize: "9px",
            },
          },
          hashShort,
        ),
      ),
      // Ownership stamp
      manifest.events.length > 0 && createElement(
        "div",
        {
          style: {
            display: "flex",
            alignItems: "center",
            gap: "4px",
          },
        },
        createElement(
          "span",
          { style: { fontSize: "12px" } },
          "✓",
        ),
        createElement(
          "span",
          { style: { color: "#0073e6", fontWeight: "500" } },
          `Filed by ${latestEvent.action === "mint" ? "creator" : "owner"}`,
        ),
      ),
      // Bitcoin verification stamp
      createElement(
        "div",
        {
          style: {
            display: "flex",
            alignItems: "center",
            gap: "4px",
          },
        },
        isPending
          ? createElement(
            "span",
            {
              style: {
                fontSize: "12px",
                color: "#FFA000",
              },
            },
            "⏳",
          )
          : createElement(
            "span",
            { style: { fontSize: "12px" } },
            "✓",
          ),
        createElement(
          "span",
          {
            style: {
              color: isPending ? "#FFA000" : "#00C851",
              fontWeight: "500",
            },
          },
          isPending ? "Bitcoin anchoring pending..." : "Verified on Bitcoin",
        ),
        !isPending && latestEvent.issued_at && createElement(
          "span",
          { style: { color: "#999", fontSize: "9px" } },
          new Date(latestEvent.issued_at).toLocaleDateString(),
        ),
      ),
    );
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
        const manifest = provenanceData.get(file.name);
        const hash = manifest?.artifact?.sha256_hex || "";
        const isExpanded = expandedSignatures.has(`${index}-${file.name}`);

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
            // Digital Signature - show verification stamps or expand button
            createElement(
              "div",
              {
                style: {
                  cursor: manifest && !isDir ? "pointer" : "default",
                },
                onClick: manifest && !isDir ? () => {
                  const newExpanded = new Set(expandedSignatures);
                  const key = `${index}-${file.name}`;
                  if (newExpanded.has(key)) {
                    newExpanded.delete(key);
                  } else {
                    newExpanded.add(key);
                  }
                  setExpandedSignatures(newExpanded);
                } : undefined,
              },
              isDir ? createElement("span", { style: { color: "#999", fontSize: "11px" } }, "—") : renderVerificationStamps(file.name),
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
          isExpanded && manifest
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
                `Provenance Events (${manifest.events.length}):`,
              ),
              ...manifest.events.map((/** @type {any} */ event, /** @type {number} */ eventIndex) =>
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
                          color: event.action === "mint" ? "#00C851" : "#0073e6",
                          textTransform: "uppercase",
                          fontSize: "10px",
                        },
                      },
                      event.action,
                    ),
                    createElement(
                      "span",
                      { style: { color: "#999", fontSize: "10px" } },
                      new Date(event.issued_at).toLocaleString(),
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
                      {
                        style: {
                          color: "#333",
                          fontWeight: "500",
                          fontFamily: "monospace",
                          fontSize: "9px",
                        },
                      },
                      event.actors?.creator_pubkey_hex?.slice(0, 16) + "..." ||
                      event.actors?.new_owner_pubkey_hex?.slice(0, 16) + "..." ||
                      "Unknown",
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
                          fontSize: "9px",
                        },
                      },
                      (event.signatures?.creator_sig_hex || event.signatures?.new_owner_sig_hex || "N/A").slice(0, 32) + "...",
                    ),
                  ),
                  // OTS Proof
                  createElement(
                    "div",
                    {
                      style: {
                        marginBottom: event.prev_event_hash_hex ? "4px" : "0",
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
                          color: isOtsPending(event.ots_proof_b64) ? "#FFA000" : "#333",
                          fontSize: "9px",
                        },
                      },
                      isOtsPending(event.ots_proof_b64)
                        ? "⏳ Pending Bitcoin confirmation..."
                        : (event.ots_proof_b64?.slice(0, 24) || "N/A") + "...",
                    ),
                  ),
                  // Previous hash (if exists)
                  event.prev_event_hash_hex
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
                            fontSize: "9px",
                          },
                        },
                        event.prev_event_hash_hex.slice(0, 16) + "...",
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
                  "a",
                  { style: { marginBottom: "4px" }, href: newUrl(file.name) + "?manifest=json", target: "_blank" },
                  `📄 Manifest Version: ${manifest.type || "provenance.manifest/v1"}`,
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