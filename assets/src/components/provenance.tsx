import React, { useState, useEffect } from 'react';
import { copyToClipboard, formatHashShort } from '../utils';

interface StampStatus {
  success: boolean;
  results?: {
    bitcoin: {
      timestamp: number;
      height: number;
    };
  };
  error?: string;
  sha256_hex?: string;
}

interface ProvenanceEvent {
  action: string;
  issued_at: string;
  actors?: {
    creator_pubkey_hex?: string;
    new_owner_pubkey_hex?: string;
  };
  signatures?: {
    creator_sig_hex?: string;
    new_owner_sig_hex?: string;
  };
  ots_proof_b64?: string;
  prev_event_hash_hex?: string;
}

interface Manifest {
  type?: string;
  artifact?: {
    sha256_hex: string;
  };
  events?: ProvenanceEvent[];
}

interface ProvenanceProps {
  fileName: string;
  defaultMode?: "full" | "summary";
  isDir?: boolean;
  stampStatus?: StampStatus | string;
}

export default function Provenance({
  fileName,
  defaultMode = "full",
  isDir = false,
  stampStatus,
}: ProvenanceProps) {
  const [copiedHash, setCopiedHash] = useState<string | null>(null);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isExpanded, setIsExpanded] = useState(defaultMode === "full");
  const isPending =
    typeof stampStatus === "string" ||
    (stampStatus && !stampStatus.success);

  /**
   * Construct URL for the file
   */
  const newUrl = (name: string): string => {
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
      }
    } catch (error) {
      console.error(`Failed to fetch provenance for ${fileName}:`, error);
    } finally {
      setIsLoading(false);
    }
  };

  // Fetch provenance data only when expanded (full view opened)
  useEffect(() => {
    if (!isDir && isExpanded && !manifest) {
      fetchProvenanceData();
    }
  }, [fileName, isDir, isExpanded]);

  const handleCopy = async (text: string, hashValue: string) => {
    const success = await copyToClipboard(text);
    if (success) {
      setCopiedHash(hashValue);
      setTimeout(() => setCopiedHash(null), 2000);
    }
  };

  // Render summary view for summary mode
  const renderSummary = () => {
    if (isLoading) {
      return (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "2px",
            fontSize: "10px",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "4px",
              color: "#999",
            }}
          >
            <span
              style={{
                display: "inline-block",
                width: "10px",
                height: "10px",
                border: "2px solid #ddd",
                borderTopColor: "#666",
                borderRadius: "50%",
                animation: "spin 0.6s linear infinite",
              }}
            />
            Loading...
          </div>
        </div>
      );
    }

    // Show stamp if we have stampStatus (even without manifest)
    if (
      !stampStatus &&
      (!manifest || !manifest.events || manifest.events.length === 0)
    ) {
      return (
        <span
          style={{
            color: "#999",
            fontSize: "11px",
          }}
        >
          —
        </span>
      );
    }

    const stampStatusObj = typeof stampStatus === 'string' ? null : stampStatus;

    return (
      <div
        style={{
          cursor: "pointer",
        }}
        onClick={() => setIsExpanded(!isExpanded)}
        title="Click to view full ownership log"
      >
        {/* Stamp-like UI */}
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            padding: "6px 10px",
            border: "2px solid " + (isPending ? "#FFA000" : "#00C851"),
            borderRadius: "4px",
            backgroundColor: isPending ? "#FFF8E1" : "#E8F5E9",
            transform: "rotate(-2deg)",
            boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
          }}
        >
          {/* OpenTimestamps icon */}
          <img
            src="https://opentimestamps.org/favicon.ico"
            alt="OpenTimestamps"
            style={{
              width: "16px",
              height: "16px",
            }}
          />
          {/* Stamp content */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "2px",
            }}
          >
            {/* Main status */}
            <div
              style={{
                fontWeight: "600",
                fontSize: "11px",
                color: isPending ? "#F57C00" : "#2E7D32",
                textTransform: "uppercase",
                letterSpacing: "0.5px",
              }}
            >
              {isPending ? "Pending" : "Verified"}
            </div>
            {/* SHA256 hash (shortened) - prefer stampStatus, fallback to manifest */}
            {(stampStatusObj?.sha256_hex || manifest?.artifact?.sha256_hex) && (
              <kbd
                style={{
                  fontSize: "9px",
                  color: isPending ? "#F57C00" : "#2E7D32",
                  backgroundColor: isPending ? "#ffe6bdff" : "#d8ffdbff",
                  borderRadius: "3px",
                  padding: "2px 4px",
                  fontFamily: "monospace",
                  userSelect: "all",
                }}
              >
                {formatHashShort(stampStatusObj?.sha256_hex || manifest?.artifact?.sha256_hex || "") + "•"}
              </kbd>
            )}
            {/* Bitcoin attestation info */}
            {stampStatusObj?.success && (
              <div
                style={{
                  fontSize: "8px",
                  color: "#666",
                  marginTop: "1px",
                  maxWidth: "60px",
                }}
              >
                {`Bitcoin block ${
                  stampStatusObj.results?.bitcoin.height
                } attests existence as of ${new Date(
                  (stampStatusObj.results?.bitcoin.timestamp ?? 0) * 1000
                ).toLocaleDateString(undefined, {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                })}`}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  // Render full ownership log view
  const renderFullView = () => {
    if (!manifest) return null;

    const hash = manifest.artifact?.sha256_hex || "";
    const stampStatusObj = typeof stampStatus === 'string' ? null : stampStatus;

    // Full mode - detailed ownership log view
    return (
      <div
        style={{
          backgroundColor: "#f9f9f9",
          padding: "16px",
          borderRadius: "4px",
          fontSize: "12px",
          border: "1px solid #e0e0e0",
        }}
      >
        {/* Title */}
        <div
          style={{
            fontWeight: "600",
            color: "#333",
            marginBottom: "12px",
            fontSize: "13px",
          }}
        >
          Cryptographic Details
        </div>
        {/* File fingerprint */}
        <div
          style={{
            marginBottom: "16px",
            paddingBottom: "12px",
            borderBottom: "1px solid #e0e0e0",
          }}
        >
          <div
            style={{
              color: "#666",
              marginBottom: "4px",
              fontSize: "11px",
            }}
          >
            Digital Fingerprint (SHA-256):
          </div>
          <div
            style={{
              fontFamily: "monospace",
              fontSize: "11px",
              wordBreak: "break-all",
              color: "#333",
              marginBottom: "6px",
            }}
          >
            {hash}
          </div>
          <button
            onClick={() => handleCopy(hash, hash)}
            style={{
              background: "none",
              border: "1px solid #ddd",
              color: copiedHash === hash ? "#00C851" : "#666",
              cursor: "pointer",
              fontSize: "11px",
              padding: "3px 8px",
              borderRadius: "3px",
            }}
          >
            {copiedHash === hash ? "Copied!" : "Copy"}
          </button>
        </div>
        {/* Events list */}
        {manifest && manifest.events && manifest.events.length > 0 ? (
          <div>
            <div
              style={{
                color: "#666",
                fontSize: "11px",
                fontWeight: "600",
              }}
            >
              {`Provenance Events (${manifest.events.length}):`}
            </div>
            <div
              style={{
                fontSize: "11px",
                marginBottom: "8px",
              }}
            >
              This shows the file has existed since this date. It doesn't prove who created it, but it helps show you were first if no one else can prove an earlier date.
            </div>
            {manifest.events.map((event: ProvenanceEvent, eventIndex: number) => (
              <div
                key={eventIndex}
                style={{
                  backgroundColor: "#fff",
                  padding: "10px",
                  marginBottom: "8px",
                  borderRadius: "3px",
                  border: "1px solid #e0e0e0",
                }}
              >
                {/* Event type and timestamp */}
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    marginBottom: "6px",
                  }}
                >
                  <span
                    style={{
                      fontWeight: "600",
                      color:
                        event.action === "mint" ? "#00C851" : "#0073e6",
                      textTransform: "uppercase",
                      fontSize: "10px",
                    }}
                  >
                    {event.action}
                  </span>
                  <span style={{ color: "#999", fontSize: "10px" }}>
                    {new Date(event.issued_at).toLocaleString()}
                  </span>
                </div>
                {/* Actor */}
                <div style={{ marginBottom: "4px" }}>
                  <span style={{ color: "#666" }}>Actor: </span>
                  <span
                    style={{
                      color: "#333",
                      fontWeight: "500",
                      fontFamily: "monospace",
                      fontSize: "9px",
                    }}
                  >
                    {event.actors?.creator_pubkey_hex?.slice(0, 16) ||
                      event.actors?.new_owner_pubkey_hex?.slice(0, 16) ||
                      "Unknown"}
                  </span>
                </div>
                {/* Signature */}
                <div
                  style={{
                    marginBottom: "4px",
                    fontSize: "10px",
                  }}
                >
                  <span style={{ color: "#666" }}>Signature: </span>
                  <span
                    style={{
                      fontFamily: "monospace",
                      color: "#333",
                      fontSize: "9px",
                    }}
                  >
                    {(
                      event.signatures?.creator_sig_hex ||
                      event.signatures?.new_owner_sig_hex ||
                      "N/A"
                    ).slice(0, 32)}
                  </span>
                </div>
                {/* Bitcoin Verification / OTS Proof */}
                <div
                  style={{
                    marginBottom: event.prev_event_hash_hex ? "4px" : "0",
                    fontSize: "10px",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                  }}
                >
                  <span style={{ color: "#666" }}>OpenTimestamps: </span>
                  <span
                    style={{
                      fontFamily: "monospace",
                      color: isPending ? "#FFA000" : "#00C851",
                      fontSize: "9px",
                    }}
                  >
                    {stampStatusObj?.success
                      ? `Bitcoin block ${
                          stampStatusObj.results?.bitcoin.height
                        } attests existence as of ${new Date(
                          (stampStatusObj.results?.bitcoin.timestamp ?? 0) * 1000
                        ).toLocaleDateString(undefined, {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        })}`
                      : "⏳ Pending Bitcoin confirmation..."}
                  </span>
                  {/* Download OTS link */}
                  {event.ots_proof_b64 && event.ots_proof_b64 !== "N/A" && (
                    <a
                      href={`${window.location.pathname}${fileName}?ots`}
                      download
                      title="Download OpenTimestamps proof (.ots)"
                      style={{
                        color: "#0073e6",
                        cursor: "pointer",
                        textDecoration: "none",
                        fontSize: "12px",
                        marginLeft: "4px",
                      }}
                    >
                      🕒 Download Proof
                    </a>
                  )}
                </div>
                {/* Previous hash (if exists) */}
                {event.prev_event_hash_hex && (
                  <div style={{ fontSize: "10px" }}>
                    <span style={{ color: "#666" }}>Previous Event Hash: </span>
                    <span
                      style={{
                        fontFamily: "monospace",
                        color: "#333",
                        fontSize: "9px",
                      }}
                    >
                      {event.prev_event_hash_hex.slice(0, 16)}
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div
            style={{
              color: "#666",
              fontSize: "11px",
              fontStyle: "italic",
            }}
          >
            No provenance events recorded
          </div>
        )}
        {/* JSON Manifest info */}
        {manifest && (
          <div
            style={{
              marginTop: "12px",
              paddingTop: "12px",
              borderTop: "1px solid #e0e0e0",
              color: "#666",
              fontSize: "11px",
            }}
          >
            <a
              style={{ marginBottom: "4px" }}
              href={`${window.location.pathname}${fileName}?manifest=json`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {`📄 Manifest Version: ${
                manifest.type || "provenance.manifest/v1"
              }`}
            </a>
            <div>
              This is a JSON manifest storing the file's fingerprint and an append-only list of signed events (mint, transfers), each with its own OpenTimestamps proof anchored to the Bitcoin blockchain.
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div>
      {renderSummary()}
      {/* Modal for expanded view */}
      {isExpanded && manifest && (
        <div
          style={{
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
          }}
          onClick={() => setIsExpanded(false)}
        >
          <div
            style={{
              backgroundColor: "#fff",
              borderRadius: "8px",
              maxWidth: "800px",
              maxHeight: "90vh",
              overflow: "auto",
              position: "relative",
            }}
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
          >
            {/* Close button */}
            <button
              onClick={() => setIsExpanded(false)}
              style={{
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
              }}
            >
              ×
            </button>
            {renderFullView()}
          </div>
        </div>
      )}
    </div>
  );
}
