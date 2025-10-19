import { useState } from "react";
import {
  Tag,
  Modal,
  Button,
  Spin,
  Space,
  Typography,
  Alert,
  Tooltip,
  Descriptions,
  Tabs,
  List,
  type DescriptionsProps,
} from "antd";
import {
  ClockCircleOutlined,
  DownloadOutlined,
  SafetyCertificateOutlined,
  CheckCircleOutlined,
  CopyOutlined,
} from "@ant-design/icons";
import { useSpring, animated } from "@react-spring/web";
import { formatHashShort, apiPath } from "../utils";

const { Text } = Typography;

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
  isDir = false,
  stampStatus,
}: ProvenanceProps) {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [expandedHashes, setExpandedHashes] = useState<{
    [key: string]: boolean;
  }>({});
  const [isFlipped, setIsFlipped] = useState(false);
  const [otsInfo, setOtsInfo] = useState<{
    file_hash: string;
    operations: string[];
  } | null>(null);
  const [isLoadingOtsInfo, setIsLoadingOtsInfo] = useState(false);
  const isPending =
    typeof stampStatus === "string" || (stampStatus && !stampStatus.success);

  // Spring animation for card flip
  const { transform } = useSpring({
    transform: `perspective(600px) rotateY(${isFlipped ? 180 : 0}deg)`,
    config: { mass: 5, tension: 500, friction: 80 },
  });

  /**
   * Format hash for display - friendly compact format
   */
  const formatHashFriendly = (hash: string, expanded = false) => {
    if (!hash) return "";
    if (expanded) {
      return hash;
    }
    // Show first 4 chars in groups
    return hash.slice(0, 4) + " " + "•••";
  };

  const toggleHashExpansion = (hashId: string) => {
    setExpandedHashes((prev) => ({ ...prev, [hashId]: !prev[hashId] }));
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
      const url = apiPath(fileName) + "?manifest=json";
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

  /**
   * Fetch OTS info for this file
   */
  const fetchOtsInfo = async () => {
    if (isDir || isLoadingOtsInfo || otsInfo) {
      return;
    }

    setIsLoadingOtsInfo(true);

    try {
      const url = apiPath(fileName) + "?ots-info";
      const response = await fetch(url);

      if (response.ok) {
        const info = await response.json();
        setOtsInfo(info);
      }
    } catch (error) {
      console.error(`Failed to fetch OTS info for ${fileName}:`, error);
    } finally {
      setIsLoadingOtsInfo(false);
    }
  };

  const handleModalOpen = () => {
    if (!manifest && !isLoading) {
      fetchProvenanceData();
    }

    if (!otsInfo && !isLoadingOtsInfo) {
      fetchOtsInfo();
    }

    // Use View Transition API for zoom animation if available
    if (document.startViewTransition) {
      document.startViewTransition(() => {
        setIsModalVisible(true);
      });
    } else {
      setIsModalVisible(true);
    }
  };

  const handleModalClose = () => {
    setIsFlipped(false); // Reset flip state when closing
    if (document.startViewTransition) {
      document.startViewTransition(() => {
        setIsModalVisible(false);
      });
    } else {
      setIsModalVisible(false);
    }
  };

  // Render summary view
  const renderSummary = () => {
    // Show stamp if we have stampStatus
    if (
      !stampStatus &&
      (!manifest || !manifest.events || manifest.events.length === 0)
    ) {
      return (
        <Text type="secondary" style={{ fontSize: 11 }}>
          —
        </Text>
      );
    }

    const stampStatusObj = typeof stampStatus === "string" ? null : stampStatus;

    return (
      <div
        onClick={handleModalOpen}
        style={{
          cursor: "pointer",
          viewTransitionName: "provenance-badge",
        }}
      >
        <Tag
          icon={
            isLoading ? (
              <Spin className="anticon" />
            ) : isPending ? (
              <ClockCircleOutlined style={{ fontSize: 20 }} />
            ) : (
              <SafetyCertificateOutlined style={{ fontSize: 20 }} />
            )
          }
          color={isPending ? "warning" : "success"}
          style={{
            fontSize: "11px",
            padding: "4px 8px",
            display: "inline-flex",
            alignItems: "center",
            gap: "4px",
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-start",
            }}
          >
            <Text strong style={{ fontSize: "10px", color: "inherit" }}>
              {isPending ? "PENDING" : "VERIFIED"}
            </Text>
            {(stampStatusObj?.sha256_hex || manifest?.artifact?.sha256_hex) && (
              <Text code style={{ fontSize: "8px", padding: "0 2px" }}>
                {formatHashShort(
                  stampStatusObj?.sha256_hex ||
                    manifest?.artifact?.sha256_hex ||
                    ""
                )}
                •
              </Text>
            )}
          </div>
        </Tag>
      </div>
    );
  };

  // Render simple side of card (like the badge, user-friendly)
  const renderSimpleSide = () => {
    if (!manifest) {
      return (
        <div style={{ padding: "40px", textAlign: "center" }}>
          <Spin size="large" />
          <div style={{ marginTop: 16 }}>
            <Text type="secondary">Loading provenance data...</Text>
          </div>
        </div>
      );
    }

    const stampStatusObj = typeof stampStatus === "string" ? null : stampStatus;
    const firstEvent = manifest.events?.[0];
    const creatorPubkey = firstEvent?.actors?.creator_pubkey_hex || "";

    const badgeColor = isPending ? "#fff7e6" : "#f6ffed"; // warning/success background
    const borderColor = isPending ? "#ffd591" : "#b7eb8f"; // warning/success border

    const items: DescriptionsProps["items"] = [
      {
        key: "integrity",
        label: (
          <Space size={8}>
            <CheckCircleOutlined style={{ color: "#52c41a" }} />
            <span>File Integrity</span>
          </Space>
        ),
        children: "Not altered",
      },
      ...(creatorPubkey
        ? [
            {
              key: "ownership",
              label: (
                <Space size={8}>
                  <CheckCircleOutlined style={{ color: "#52c41a" }} />
                  <span>Ownership</span>
                </Space>
              ),
              children: "Verified by me",
            },
          ]
        : []),
      {
        key: "bitcoin",
        label: (
          <Space size={8}>
            {stampStatusObj?.success ? (
              <CheckCircleOutlined style={{ color: "#52c41a" }} />
            ) : (
              <ClockCircleOutlined style={{ color: "#fa8c16" }} />
            )}
            <span>Bitcoin</span>
          </Space>
        ),
        children:
          stampStatusObj?.success && stampStatusObj.results
            ? `Verified ${new Date(
                stampStatusObj.results.bitcoin.timestamp * 1000
              ).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}`
            : "Pending confirmation",
      },
    ];

    return (
      <div
        style={{
          padding: "20px",
          cursor: "pointer",
          backgroundColor: badgeColor,
          border: `1px solid ${borderColor}`,
        }}
        onClick={() => setIsFlipped(true)}
      >
        <div style={{ textAlign: "center", marginBottom: 16 }}>
          <Tag
            icon={
              isPending ? (
                <ClockCircleOutlined />
              ) : (
                <SafetyCertificateOutlined />
              )
            }
            color={isPending ? "warning" : "success"}
            style={{
              fontSize: "16px",
              padding: "6px 12px",
            }}
          >
            {isPending ? "PENDING" : "VERIFIED"}
          </Tag>
        </div>

        <Descriptions
          size="small"
          column={1}
          items={items}
          labelStyle={{ fontWeight: 600 }}
          contentStyle={{ textAlign: "right" }}
        />

        {stampStatusObj?.success && stampStatusObj.results && (
          <Alert
            message="File existed since this date. Doesn't prove who created it."
            type="info"
            showIcon={false}
            style={{ marginTop: 12, fontSize: 11 }}
          />
        )}

        <div style={{ textAlign: "center", marginTop: 12 }}>
          <Text type="secondary" style={{ fontSize: 11 }}>
            Click for details
          </Text>
        </div>
      </div>
    );
  };

  // Render detailed side of card (cryptographic details)
  const renderDetailedSide = () => {
    if (!manifest) {
      return (
        <div style={{ padding: "40px", textAlign: "center" }}>
          <Spin size="large" />
          <div style={{ marginTop: 16 }}>
            <Text type="secondary">Loading provenance data...</Text>
          </div>
        </div>
      );
    }

    const hash = manifest.artifact?.sha256_hex || "";
    const stampStatusObj = typeof stampStatus === "string" ? null : stampStatus;
    const firstEvent = manifest.events?.[0];
    const creatorPubkey = firstEvent?.actors?.creator_pubkey_hex || "";

    // Tab 1: Cryptographic Details
    const cryptoItems: DescriptionsProps["items"] = [
      {
        key: "hash",
        label: "SHA-256 Hash",
        children: (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Text
              code
              onClick={(e) => {
                e.stopPropagation();
                toggleHashExpansion("main-hash");
              }}
              style={{
                fontSize: 11,
                cursor: "pointer",
                wordBreak: "break-all",
              }}
            >
              {formatHashFriendly(hash, expandedHashes["main-hash"])}
            </Text>
            <Tooltip title="Copy">
              <Button
                type="text"
                size="small"
                icon={<CopyOutlined />}
                onClick={(e) => {
                  e.stopPropagation();
                  navigator.clipboard.writeText(hash);
                }}
              />
            </Tooltip>
          </div>
        ),
      },
      ...(creatorPubkey
        ? [
            {
              key: "pubkey",
              label: "Public Key",
              children: (
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Text
                    code
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleHashExpansion("pubkey");
                    }}
                    style={{
                      fontSize: 11,
                      cursor: "pointer",
                      wordBreak: "break-all",
                    }}
                  >
                    {formatHashFriendly(
                      creatorPubkey,
                      expandedHashes["pubkey"]
                    )}
                  </Text>
                  <Tooltip title="Copy">
                    <Button
                      type="text"
                      size="small"
                      icon={<CopyOutlined />}
                      onClick={(e) => {
                        e.stopPropagation();
                        navigator.clipboard.writeText(creatorPubkey);
                      }}
                    />
                  </Tooltip>
                </div>
              ),
            },
          ]
        : []),
      ...(stampStatusObj
        ? [
            {
              key: "bitcoin",
              label: "Bitcoin Block",
              children:
                stampStatusObj.success && stampStatusObj.results ? (
                  <Tag color="success" icon={<CheckCircleOutlined />}>
                    Block #{stampStatusObj.results.bitcoin.height}
                  </Tag>
                ) : (
                  <Tag color="warning" icon={<ClockCircleOutlined />}>
                    Pending
                  </Tag>
                ),
            },
          ]
        : []),
      ...(firstEvent?.ots_proof_b64 && firstEvent.ots_proof_b64 !== "N/A"
        ? [
            {
              key: "ots",
              label: "OTS Proof",
              children: (
                <Button
                  type="link"
                  size="small"
                  icon={<DownloadOutlined />}
                  href={`${window.location.pathname}${fileName}?ots`}
                  download
                  style={{ padding: 0 }}
                  onClick={(e) => e.stopPropagation()}
                >
                  Download
                </Button>
              ),
            },
          ]
        : []),
    ];

    // Tab 2: Provenance Events
    const events = manifest.events || [];

    // Tab 3: Manifest JSON
    const manifestJson = JSON.stringify(manifest, null, 2);

    const tabItems = [
      {
        key: "crypto",
        label: "Details",
        children: (
          <div onClick={(e) => e.stopPropagation()}>
            <Descriptions
              size="small"
              column={1}
              items={cryptoItems}
              labelStyle={{ fontWeight: 600, fontSize: 12 }}
              contentStyle={{ fontSize: 12 }}
            />
          </div>
        ),
      },
      {
        key: "events",
        label: `Events (${events.length})`,
        children: (
          <div onClick={(e) => e.stopPropagation()}>
            <List
              size="small"
              dataSource={events}
              renderItem={(event, index) => (
                <List.Item>
                  <List.Item.Meta
                    title={
                      <Space>
                        <Text strong style={{ fontSize: 12 }}>
                          {event.action}
                        </Text>
                        <Text type="secondary" style={{ fontSize: 11 }}>
                          {new Date(event.issued_at).toLocaleString()}
                        </Text>
                      </Space>
                    }
                    description={
                      <div style={{ fontSize: 11 }}>
                        {event.actors?.creator_pubkey_hex && (
                          <div>
                            Creator: {formatHashShort(event.actors.creator_pubkey_hex)}
                          </div>
                        )}
                        {event.ots_proof_b64 && event.ots_proof_b64 !== "N/A" && (
                          <div>OTS: {event.ots_proof_b64.slice(0, 20)}...</div>
                        )}
                        {index > 0 && event.prev_event_hash_hex && (
                          <div>
                            Prev: {formatHashShort(event.prev_event_hash_hex)}
                          </div>
                        )}
                      </div>
                    }
                  />
                </List.Item>
              )}
            />
          </div>
        ),
      },
      {
        key: "ots-info",
        label: "Timestamp Proof",
        children: (
          <div onClick={(e) => e.stopPropagation()}>
            {isLoadingOtsInfo ? (
              <div style={{ textAlign: "center", padding: "20px" }}>
                <Spin />
              </div>
            ) : otsInfo ? (
              <div style={{ fontSize: 12 }}>
                {/* Show verification status if available */}
                {stampStatusObj?.success && stampStatusObj.results ? (
                  <Alert
                    message="✅ Verified on Bitcoin Blockchain"
                    description={`This file's timestamp was confirmed in Bitcoin block #${stampStatusObj.results.bitcoin.height} on ${new Date(
                      stampStatusObj.results.bitcoin.timestamp * 1000
                    ).toLocaleString("en-US", {
                      month: "long",
                      day: "numeric",
                      year: "numeric",
                      hour: "numeric",
                      minute: "numeric",
                    })}. The proof below shows how your file connects to this block.`}
                    type="success"
                    showIcon
                    style={{ fontSize: 11, marginBottom: 12 }}
                  />
                ) : (
                  <Alert
                    message="⏳ Pending Bitcoin Confirmation"
                    description="Your file has been submitted for timestamping. The proof will be complete once it's included in a Bitcoin block (usually within a few hours)."
                    type="warning"
                    showIcon
                    style={{ fontSize: 11, marginBottom: 12 }}
                  />
                )}

                <div style={{ marginBottom: 16 }}>
                  <Text strong style={{ fontSize: 12 }}>Starting Point:</Text>
                  <br />
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    Your file's unique fingerprint
                  </Text>
                  <br />
                  <Text
                    code
                    style={{
                      fontSize: 10,
                      wordBreak: "break-all",
                      display: "block",
                      marginTop: 4
                    }}
                  >
                    {otsInfo.file_hash}
                  </Text>
                </div>

                <div>
                  <Text strong style={{ fontSize: 12 }}>Proof Steps:</Text>
                  <br />
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    How we get from your file to the blockchain
                  </Text>
                  <div
                    style={{
                      fontFamily: "monospace",
                      fontSize: 11,
                      lineHeight: "1.6",
                      whiteSpace: "pre-wrap",
                      backgroundColor: "#f5f5f5",
                      padding: "12px",
                      borderRadius: "4px",
                      marginTop: "8px",
                      maxHeight: "300px",
                      overflow: "auto",
                      border: "1px solid #e8e8e8"
                    }}
                  >
                    {otsInfo.operations.map((op, idx) => {
                      // Make operations more readable
                      let displayOp = op;

                      // Simplify technical operations
                      if (op.includes("→ sha256") && !op.includes("append") && !op.includes("prepend")) {
                        displayOp = op.replace("→ sha256", "🔐 Hash with SHA-256");
                      } else if (op.includes("→ append")) {
                        displayOp = op.replace("→ append", "➕ Combine with");
                      } else if (op.includes("→ prepend")) {
                        displayOp = op.replace("→ prepend", "➕ Combine with");
                      } else if (op.includes("✓ Bitcoin block attestation")) {
                        displayOp = op.replace("✓", "✅");
                        displayOp = displayOp.replace("attestation", "");
                      } else if (op.includes("⏳ Pending attestation")) {
                        displayOp = op.replace("attestation:", "confirmation:");
                      }

                      // Style Bitcoin confirmations differently
                      const isBitcoinConfirmation = displayOp.includes("✅ Bitcoin");
                      const isPendingOp = displayOp.includes("⏳");

                      return (
                        <div
                          key={idx}
                          style={{
                            color: isBitcoinConfirmation ? "#52c41a" : isPendingOp ? "#fa8c16" : "inherit",
                            fontWeight: isBitcoinConfirmation ? 600 : "normal",
                          }}
                        >
                          {displayOp}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {stampStatusObj?.success && stampStatusObj.results ? (
                  <Alert
                    message="What does this mean?"
                    description={`This proof is permanent and cryptographically verifiable. Anyone can confirm that this exact file existed on ${new Date(
                      stampStatusObj.results.bitcoin.timestamp * 1000
                    ).toLocaleDateString("en-US", {
                      month: "long",
                      day: "numeric",
                      year: "numeric",
                    })} by checking Bitcoin block #${stampStatusObj.results.bitcoin.height}.`}
                    type="info"
                    showIcon
                    style={{ fontSize: 11, marginTop: 12 }}
                  />
                ) : (
                  <Alert
                    message="What happens next?"
                    description="Once your timestamp is included in a Bitcoin block, you'll see a green checkmark above. The pending calendar servers shown above are collecting timestamps to batch them into the blockchain."
                    type="info"
                    showIcon
                    style={{ fontSize: 11, marginTop: 12 }}
                  />
                )}
              </div>
            ) : (
              <Alert
                message="Timestamp proof not available"
                description="No timestamp proof found for this file."
                type="info"
                showIcon
                style={{ fontSize: 11 }}
              />
            )}
          </div>
        ),
      },
      {
        key: "json",
        label: "JSON",
        children: (
          <div onClick={(e) => e.stopPropagation()}>
            <Space direction="vertical" style={{ width: "100%" }}>
              <Button
                type="link"
                href={`${window.location.pathname}${fileName}?manifest=json`}
                target="_blank"
                rel="noopener noreferrer"
                size="small"
                style={{ padding: 0 }}
                onClick={(e) => e.stopPropagation()}
              >
                Open in New Tab
              </Button>
              <Typography.Text
                code
                style={{
                  fontSize: 10,
                  display: "block",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-all",
                  maxHeight: "300px",
                  overflow: "auto",
                  padding: "8px",
                  backgroundColor: "#f5f5f5",
                }}
              >
                {manifestJson}
              </Typography.Text>
            </Space>
          </div>
        ),
      },
    ];

    return (
      <div
        style={{
          padding: "16px",
          cursor: "pointer",
        }}
        onClick={() => setIsFlipped(false)}
      >
        <Tabs
          defaultActiveKey="crypto"
          size="small"
          items={tabItems}
          onClick={(e) => e.stopPropagation()}
        />

        <div style={{ textAlign: "center", marginTop: 8 }}>
          <Text type="secondary" style={{ fontSize: 11 }}>
            Click to go back
          </Text>
        </div>
      </div>
    );
  };

  return (
    <>
      {renderSummary()}
      <Modal
        title={isFlipped ? `Provenance Details: ${fileName}` : undefined}
        open={isModalVisible}
        onCancel={handleModalClose}
        footer={null}
        width={700}
        styles={{
          body: {
            padding: 0,
            viewTransitionName: "provenance-badge",
          },
          content: {
            padding: isFlipped ? undefined : 0,
          },
        }}
        modalRender={(modal) => (
          <animated.div
            style={{
              transformStyle: "preserve-3d",
              transform,
              viewTransitionName: "provenance-badge",
            }}
          >
            <div style={{ transform: isFlipped ? "scaleX(-1)" : "none" }}>
              {modal}
            </div>
          </animated.div>
        )}
      >
        {isFlipped ? renderDetailedSide() : renderSimpleSide()}
      </Modal>
    </>
  );
}
