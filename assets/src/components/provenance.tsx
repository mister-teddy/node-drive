import { useState, useEffect, useMemo } from "react";
import { useAtomValue } from "jotai";
import { loadable } from "jotai/utils";
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
import { formatHashShort } from "../utils";
import OtsViewer from "./ots-viewer";
import { manifestAtomFamily, otsInfoAtomFamily } from "../state";

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

interface ProvenanceProps {
  fileName: string;
  defaultMode?: "full" | "summary";
  isDir?: boolean;
  stampStatus?: StampStatus | string;
  shareId?: string;
}

export default function Provenance({
  fileName,
  isDir = false,
  stampStatus,
  shareId,
}: ProvenanceProps) {
  // Create loadable atoms - ALWAYS created to comply with Rules of Hooks
  const manifestAtom = useMemo(
    () => loadable(manifestAtomFamily({ fileName, shareId })),
    [fileName, shareId]
  );
  const otsInfoAtom = useMemo(
    () => loadable(otsInfoAtomFamily({ fileName, shareId })),
    [fileName, shareId]
  );

  // ALWAYS call hooks unconditionally (Rules of Hooks)
  const manifestLoadable = useAtomValue(manifestAtom);
  const otsInfoLoadable = useAtomValue(otsInfoAtom);

  // Derive manifest and loading states from loadable
  // For directories, just ignore the results
  const manifest =
    !isDir && manifestLoadable?.state === "hasData"
      ? manifestLoadable.data
      : null;
  const isLoading =
    !isDir && manifestLoadable?.state === "loading" ? true : false;

  // Derive OTS info and loading states from loadable
  const otsInfo =
    !isDir && otsInfoLoadable?.state === "hasData"
      ? otsInfoLoadable.data
      : null;
  const isLoadingOtsInfo =
    !isDir && otsInfoLoadable?.state === "loading" ? true : false;

  const [isModalVisible, setIsModalVisible] = useState(false);
  const [expandedHashes, setExpandedHashes] = useState<{
    [key: string]: boolean;
  }>({});
  const [isFlipped, setIsFlipped] = useState(false);
  const isPending =
    (typeof stampStatus === "string" ||
      (stampStatus && !stampStatus.success)) &&
    !manifest?.artifact?.verified_timestamp;

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

  // Log errors if any
  useEffect(() => {
    if (manifestLoadable?.state === "hasError") {
      console.error(
        `Failed to fetch provenance for ${fileName}:`,
        manifestLoadable.error
      );
    }
  }, [manifestLoadable, fileName]);

  useEffect(() => {
    if (otsInfoLoadable?.state === "hasError") {
      console.error(
        `Failed to fetch OTS info for ${fileName}:`,
        otsInfoLoadable.error
      );
    }
  }, [otsInfoLoadable, fileName]);

  const handleModalOpen = () => {
    // Data will load automatically when atoms are subscribed
    setIsModalVisible(true);
  };

  const handleModalClose = () => {
    setIsFlipped(false); // Reset flip state when closing
    setIsModalVisible(false);
  };

  // Render summary view
  const renderSummary = () => {
    // Show stamp if we have stampStatus
    if (
      !stampStatus &&
      (!manifest || !manifest.events || manifest.events.length === 0)
    ) {
      return (
        <Text type="secondary" className="text-[11px]">
          —
        </Text>
      );
    }

    const stampStatusObj = typeof stampStatus === "string" ? null : stampStatus;

    return (
      <div onClick={handleModalOpen} className="inline-block cursor-pointer">
        <div
          className={`relative px-4 py-3 rounded border-4 transition-all hover:scale-105 hover:shadow-lg min-w-[140px] ${
            isPending
              ? "bg-orange-50 border-orange-400 shadow-orange-200"
              : "bg-green-50 border-green-500 shadow-green-200"
          }`}
          style={{
            borderStyle: "double",
            boxShadow: isPending
              ? "0 4px 12px rgba(250, 140, 22, 0.3)"
              : "0 4px 12px rgba(82, 196, 26, 0.3)",
          }}
        >
          {/* Corner decorations for stamp effect */}
          <div
            className="absolute top-1 left-1 w-2 h-2 border-t-2 border-l-2"
            style={{
              borderColor: isPending ? "#fa8c16" : "#52c41a",
            }}
          />
          <div
            className="absolute top-1 right-1 w-2 h-2 border-t-2 border-r-2"
            style={{
              borderColor: isPending ? "#fa8c16" : "#52c41a",
            }}
          />
          <div
            className="absolute bottom-1 left-1 w-2 h-2 border-b-2 border-l-2"
            style={{
              borderColor: isPending ? "#fa8c16" : "#52c41a",
            }}
          />
          <div
            className="absolute bottom-1 right-1 w-2 h-2 border-b-2 border-r-2"
            style={{
              borderColor: isPending ? "#fa8c16" : "#52c41a",
            }}
          />

          <Space direction="vertical" size={2} className="w-full text-center">
            {/* Bitcoin symbol + icon */}
            <div
              className={`text-2xl font-bold ${
                isPending ? "text-orange-600" : "text-green-600"
              }`}
            >
              {isLoading ? (
                <Spin />
              ) : isPending ? (
                <ClockCircleOutlined />
              ) : (
                <SafetyCertificateOutlined />
              )}
            </div>

            {/* Bitcoin branding */}
            <Text
              strong
              className={`text-xs ${
                isPending ? "text-orange-700" : "text-green-700"
              }`}
            >
              ₿ BITCOIN
            </Text>

            {/* Status */}
            <Tag
              color={isPending ? "orange" : "green"}
              className="text-xs font-bold m-0"
            >
              {isPending ? "PENDING" : "VERIFIED"}
            </Tag>

            {/* Block or Hash info */}
            {(stampStatusObj?.sha256_hex || manifest?.artifact?.sha256_hex) && (
              <Text className="text-[10px]! text-gray-600 break-all px-1">
                {stampStatusObj?.results?.bitcoin ? (
                  <>Block #{stampStatusObj.results.bitcoin.height}</>
                ) : (
                  <>
                    {formatHashShort(
                      stampStatusObj?.sha256_hex ||
                        manifest?.artifact?.sha256_hex ||
                        ""
                    )}
                  </>
                )}
              </Text>
            )}
          </Space>
        </div>
      </div>
    );
  };

  // Render simple side of card (like the badge, user-friendly)
  const renderSimpleSide = () => {
    if (!manifest) {
      return (
        <div className="p-10 text-center">
          <Spin size="large" />
          <div className="mt-4">
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
            <CheckCircleOutlined className="text-green-500" />
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
                  <CheckCircleOutlined className="text-green-500" />
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
            {stampStatusObj?.success ||
            manifest.artifact?.verified_timestamp ? (
              <CheckCircleOutlined className="text-green-500" />
            ) : (
              <ClockCircleOutlined className="text-orange-500" />
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
            : manifest.artifact?.verified_timestamp
            ? `Verified ${new Date(
                manifest.artifact.verified_timestamp * 1000
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
        className="p-5 cursor-pointer rounded-lg"
        style={{
          backgroundColor: badgeColor,
          border: `1px solid ${borderColor}`,
        }}
        onClick={() => setIsFlipped(true)}
      >
        <div className="text-center mb-4">
          <Tag
            icon={
              isPending ? (
                <ClockCircleOutlined />
              ) : (
                <SafetyCertificateOutlined />
              )
            }
            color={isPending ? "warning" : "success"}
            className="text-base px-3 py-1.5"
          >
            {isPending ? "PENDING" : "VERIFIED"}
          </Tag>
        </div>

        <Descriptions bordered column={1} items={items} />

        <div className="text-center mt-3">
          <Text type="secondary" className="text-[11px]">
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
        <div className="p-10 text-center">
          <Spin size="large" />
          <div className="mt-4">
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
          <div className="flex items-center gap-2">
            <Text
              code
              onClick={(e) => {
                e.stopPropagation();
                toggleHashExpansion("main-hash");
              }}
              className="cursor-pointer break-all"
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
                <div className="flex items-center gap-2">
                  <Text
                    code
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleHashExpansion("pubkey");
                    }}
                    className="cursor-pointer break-all"
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
      ...(stampStatusObj || manifest.artifact?.verified_height
        ? [
            {
              key: "bitcoin",
              label: "Bitcoin Block",
              children:
                stampStatusObj?.success && stampStatusObj.results ? (
                  <Tag color="success" icon={<CheckCircleOutlined />}>
                    Block #{stampStatusObj.results.bitcoin.height}
                  </Tag>
                ) : manifest.artifact?.verified_height ? (
                  <Tag color="success" icon={<CheckCircleOutlined />}>
                    Block #{manifest.artifact.verified_height}
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
                  className="p-0"
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
                                  <div className="flex items-center gap-2">
                                    <Text
                                      code
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        toggleHashExpansion(
                                          `actor-creator-${index}`
                                        );
                                      }}
                                      className="cursor-pointer break-all"
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
        label: "Provenance Manifest",
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
      <div className="cursor-pointer" onClick={() => setIsFlipped(false)}>
        <Tabs
          defaultActiveKey="crypto"
          size="small"
          items={tabItems}
          onClick={(e) => e.stopPropagation()}
        />

        <div className="text-center mt-2">
          <Text type="secondary" className="text-[11px]">
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
            }}
          >
            <div
              style={{
                transform: `scaleX(${isFlipped ? -1 : 1})`,
                transition: "transform 0.6s",
              }}
            >
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
