// @ts-check

import { useState, useEffect, createElement } from "../esm-imports.js";
import { getStampStatus } from "../node-drive.js";
import { copyToClipboard, formatHashShort } from "../utils.js";

/**
 * Provenance component - self-contained component that manages its own state and data fetching
 * @param {{
 *   fileName: string,
 *   defaultMode?: "full" | "summary",
 *   isDir?: boolean
 * }} props
 */
export default function Provenance({
  fileName,
  defaultMode = "full",
  isDir = false,
}) {
  const [copiedHash, setCopiedHash] = useState(null);
  const [manifest, setManifest] = useState(/** @type {any} */ (null));
  const [isLoading, setIsLoading] = useState(false);
  const [isExpanded, setIsExpanded] = useState(defaultMode === "full");
  /**
   * @type {[Awaited<ReturnType<typeof getStampStatus>>, Function]}
   */
  const [stampStatus, setStampStatus] = useState("verifying");
  const isPending = typeof stampStatus === "string";

  /**
   * Construct URL for the file
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
   * Fetch provenance data for this file
   */
  const fetchProvenanceData = async () => {
    if (isDir || isLoading || manifest) {
      return;
    }

    setIsLoading(true);

    try {
      const url = newUrl(fileName) + "?manifest=json";
      const response = await fetch(url);

      if (response.ok) {
        const manifestData = await response.json();
        setManifest(manifestData);
        if (manifestData.events.length) {
          const latestEvent =
            manifestData.events[manifestData.events.length - 1];
          setStampStatus(
            await getStampStatus({
              otsProofBase64: latestEvent.ots_proof_b64,
              artifactSha256: latestEvent.artifact_sha256_hex,
            })
          );
        }
      }
    } catch (error) {
      console.error(`Failed to fetch provenance for ${fileName}:`, error);
    } finally {
      setIsLoading(false);
    }
  };

  // Fetch provenance data on mount
  useEffect(() => {
    if (!isDir) {
      fetchProvenanceData();
    }
  }, [fileName, isDir]);

  /**
   * @param {string} text
   * @param {string} hashValue
   */
  const handleCopy = async (text, hashValue) => {
    const success = await copyToClipboard(text);
    if (success) {
      setCopiedHash(hashValue);
      setTimeout(() => setCopiedHash(null), 2000);
    }
  };

  // Render summary view for summary mode
  const renderSummary = () => {
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
          createElement("span", {
            style: {
              display: "inline-block",
              width: "10px",
              height: "10px",
              border: "2px solid #ddd",
              borderTopColor: "#666",
              borderRadius: "50%",
              animation: "spin 0.6s linear infinite",
            },
          }),
          "Loading..."
        )
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
        "—"
      );
    }

    const latestEvent = manifest.events[manifest.events.length - 1];

    return createElement(
      "div",
      {
        style: {
          cursor: "pointer",
        },
        onClick: () => setIsExpanded(!isExpanded),
        title: "Click to view full ownership log",
      },
      // Stamp-like UI
      createElement(
        "div",
        {
          style: {
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            padding: "6px 10px",
            border: "2px solid " + (isPending ? "#FFA000" : "#00C851"),
            borderRadius: "4px",
            backgroundColor: isPending ? "#FFF8E1" : "#E8F5E9",
            transform: "rotate(-2deg)",
            boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
          },
        },
        // OpenTimestamps icon
        createElement("img", {
          src: "https://opentimestamps.org/favicon.ico",
          alt: "OpenTimestamps",
          style: {
            width: "16px",
            height: "16px",
          },
        }),
        // Stamp content
        createElement(
          "div",
          {
            style: {
              display: "flex",
              flexDirection: "column",
              gap: "2px",
            },
          },
          // Main status
          createElement(
            "div",
            {
              style: {
                fontWeight: "600",
                fontSize: "11px",
                color: isPending ? "#F57C00" : "#2E7D32",
                textTransform: "uppercase",
                letterSpacing: "0.5px",
              },
            },
            isPending ? "Pending" : "Verified"
          ),
          // SHA256 hash (shortened)
          !!manifest.artifact?.sha256_hex &&
            createElement(
              "kbd",
              {
                style: {
                  fontSize: "9px",
                  color: isPending ? "#F57C00" : "#2E7D32",
                  backgroundColor: isPending ? "#ffe6bdff" : "#d8ffdbff",
                  borderRadius: "3px",
                  padding: "2px 4px",
                  fontFamily: "monospace",
                  userSelect: "all",
                },
              },
              formatHashShort(manifest.artifact.sha256_hex) + "•"
            ),
          // Bitcoin attestation info
          typeof stampStatus === "object" &&
            createElement(
              "div",
              {
                style: {
                  fontSize: "8px",
                  color: "#666",
                  marginTop: "1px",
                  maxWidth: "60px",
                },
              },
              `Bitcoin block ${
                stampStatus.bitcoin.height
              } attests existence as of ${new Date(
                stampStatus.bitcoin.timestamp * 1000
              ).toLocaleDateString(undefined, {
                year: "numeric",
                month: "short",
                day: "numeric",
              })}`
            )
        )
      )
    );
  };

  // Render full ownership log view
  const renderFullView = () => {
    if (!manifest) return null;

    const hash = manifest.artifact?.sha256_hex || "";

    // Full mode - detailed ownership log view
    return createElement(
      "div",
      {
        style: {
          backgroundColor: "#f9f9f9",
          padding: "16px",
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
        "Cryptographic Details"
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
          "Digital Fingerprint (SHA-256):"
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
          hash
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
          copiedHash === hash ? "Copied!" : "Copy"
        )
      ),
      // Events list
      manifest && manifest.events && manifest.events.length > 0
        ? createElement(
            "div",
            null,
            createElement(
              "div",
              {
                style: {
                  color: "#666",
                  fontSize: "11px",
                  fontWeight: "600",
                },
              },
              `Provenance Events (${manifest.events.length}):`
            ),
            createElement(
              "div",
              {
                style: {
                  fontSize: "11px",
                  marginBottom: "8px",
                },
              },
              "This shows the file has existed since this date. It doesn't prove who created it, but it helps show you were first if no one else can prove an earlier date."
            ),
            ...manifest.events.map(
              (/** @type {any} */ event, /** @type {number} */ eventIndex) =>
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
                          color:
                            event.action === "mint" ? "#00C851" : "#0073e6",
                          textTransform: "uppercase",
                          fontSize: "10px",
                        },
                      },
                      event.action
                    ),
                    createElement(
                      "span",
                      { style: { color: "#999", fontSize: "10px" } },
                      new Date(event.issued_at).toLocaleString()
                    )
                  ),
                  // Actor
                  createElement(
                    "div",
                    { style: { marginBottom: "4px" } },
                    createElement(
                      "span",
                      { style: { color: "#666" } },
                      "Actor: "
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
                      event.actors?.creator_pubkey_hex?.slice(0, 16) ||
                        event.actors?.new_owner_pubkey_hex?.slice(0, 16) ||
                        "Unknown"
                    )
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
                      "Signature: "
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
                      (
                        event.signatures?.creator_sig_hex ||
                        event.signatures?.new_owner_sig_hex ||
                        "N/A"
                      ).slice(0, 32)
                    )
                  ),
                  // Bitcoin Verification / OTS Proof
                  createElement(
                    "div",
                    {
                      style: {
                        marginBottom: event.prev_event_hash_hex ? "4px" : "0",
                        fontSize: "10px",
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                      },
                    },
                    createElement(
                      "span",
                      { style: { color: "#666" } },
                      "OpenTimestamps: "
                    ),
                    createElement(
                      "span",
                      {
                        style: {
                          fontFamily: "monospace",
                          color: isPending ? "#FFA000" : "#00C851",
                          fontSize: "9px",
                        },
                      },
                      typeof stampStatus === "object"
                        ? `Bitcoin block ${
                            stampStatus.bitcoin.height
                          } attests existence as of ${new Date(
                            stampStatus.bitcoin.timestamp * 1000
                          ).toLocaleDateString(undefined, {
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                          })}`
                        : "⏳ Pending Bitcoin confirmation..."
                    ),
                    // Download OTS link
                    event.ots_proof_b64 && event.ots_proof_b64 !== "N/A"
                      ? createElement(
                          "a",
                          {
                            href: `${window.location.pathname}${fileName}?ots`,
                            download: true,
                            title: "Download OpenTimestamps proof (.ots)",
                            style: {
                              color: "#0073e6",
                              cursor: "pointer",
                              textDecoration: "none",
                              fontSize: "12px",
                              marginLeft: "4px",
                            },
                          },
                          "🕒 Download Proof"
                        )
                      : null
                  ),
                  // Previous hash (if exists)
                  event.prev_event_hash_hex
                    ? createElement(
                        "div",
                        { style: { fontSize: "10px" } },
                        createElement(
                          "span",
                          { style: { color: "#666" } },
                          "Previous Event Hash: "
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
                          event.prev_event_hash_hex.slice(0, 16)
                        )
                      )
                    : null
                )
            )
          )
        : createElement(
            "div",
            {
              style: {
                color: "#666",
                fontSize: "11px",
                fontStyle: "italic",
              },
            },
            "No provenance events recorded"
          ),
      // JSON Manifest info
      manifest
        ? createElement(
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
              {
                style: { marginBottom: "4px" },
                href: `${window.location.pathname}${fileName}?manifest=json`,
                target: "_blank",
                rel: "noopener noreferrer",
              },
              `📄 Manifest Version: ${
                manifest.type || "provenance.manifest/v1"
              }`
            ),
            createElement(
              "div",
              null,
              "This is a JSON manifest storing the file's fingerprint and an append-only list of signed events (mint, transfers), each with its own OpenTimestamps proof anchored to the Bitcoin blockchain."
            )
          )
        : null
    );
  };

  return createElement(
    "div",
    null,
    renderSummary(),
    // Modal for expanded view
    isExpanded && manifest
      ? createElement(
          "div",
          {
            style: {
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: "rgba(0, 0, 0, 0.5)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 1000,
              padding: "20px",
            },
            onClick: () => setIsExpanded(false),
          },
          createElement(
            "div",
            {
              style: {
                backgroundColor: "#fff",
                borderRadius: "8px",
                maxWidth: "800px",
                maxHeight: "90vh",
                overflow: "auto",
                position: "relative",
              },
              onClick: (/** @type {MouseEvent} */ e) => e.stopPropagation(),
            },
            // Close button
            createElement(
              "button",
              {
                onClick: () => setIsExpanded(false),
                style: {
                  position: "absolute",
                  top: "10px",
                  right: "10px",
                  background: "none",
                  border: "none",
                  fontSize: "20px",
                  cursor: "pointer",
                  color: "#999",
                  padding: 0,
                  lineHeight: 1,
                  fontWeight: "bold",
                },
              },
              "×"
            ),
            renderFullView()
          )
        )
      : null
  );
}
