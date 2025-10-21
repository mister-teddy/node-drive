import { useState } from "react";
import {
  Tag,
  Modal,
  Button,
  Spin,
  Space,
  Typography,
  Tooltip,
  Descriptions,
  Tabs,
  type DescriptionsProps,
  Steps,
  Badge,
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
import OtsViewer from "./ots-viewer";

const { Text, Paragraph } = Typography;

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
          borderRadius: 8,
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

        <Descriptions bordered column={1} items={items} />

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
            <Descriptions bordered column={1} items={cryptoItems} />
          </div>
        ),
      },
      {
        key: "events",
        label: `Events (${events.length})`,
        children: (
          <div onClick={(e) => e.stopPropagation()}>
            <Steps
              className="[&_.ant-steps-item]:w-full"
              items={events.map((event, index) => ({
                key: `event-${index}`,
                title: new Date(event.issued_at).toLocaleString(),
                description: (
                  <Badge.Ribbon
                    text={event.action}
                    color="blue"
                    rootClassName="w-[604px]"
                  >
                    {event.actors && (
                      <Descriptions
                        bordered
                        column={1}
                        size="small"
                        items={[
                          {
                            key: `actors-${index}`,
                            label: <Text strong>Actors</Text>,
                            children: (
                              <>
                                {event.actors?.creator_pubkey_hex && (
                                  <div
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      gap: 8,
                                    }}
                                  >
                                    <Text
                                      code
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        toggleHashExpansion(
                                          `actor-creator-${index}`
                                        );
                                      }}
                                      style={{
                                        cursor: "pointer",
                                        wordBreak: "break-all",
                                      }}
                                    >
                                      Creator PubKey:{" "}
                                      {formatHashFriendly(
                                        event.actors.creator_pubkey_hex,
                                        expandedHashes[`actor-creator-${index}`]
                                      )}
                                    </Text>
                                    <Tooltip title="Copy">
                                      <Button
                                        type="text"
                                        size="small"
                                        icon={<CopyOutlined />}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          navigator.clipboard.writeText(
                                            event.actors?.creator_pubkey_hex ??
                                              ""
                                          );
                                        }}
                                      />
                                    </Tooltip>
                                  </div>
                                )}
                              </>
                            ),
                          },
                        ]}
                      />
                    )}
                  </Badge.Ribbon>
                ),
              }))}
            ></Steps>
          </div>
        ),
      },
      {
        key: "ots-info",
        label: "Timestamp Proof",
        children: (
          <div onClick={(e) => e.stopPropagation()}>
            <OtsViewer
              otsInfo={otsInfo}
              stampStatus={stampStatus}
              isLoading={isLoadingOtsInfo}
            />
          </div>
        ),
      },
      {
        key: "json",
        label: "JSON",
        children: (
          <div onClick={(e) => e.stopPropagation()}>
            <Paragraph>
              <pre>{manifestJson}</pre>
            </Paragraph>
          </div>
        ),
      },
    ];

    return (
      <div
        style={{
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
