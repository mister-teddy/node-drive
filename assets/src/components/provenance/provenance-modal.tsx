import { useState, Suspense } from "react";
import { useAtomValue } from "jotai";
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
  Skeleton,
} from "antd";
import {
  ClockCircleOutlined,
  DownloadOutlined,
  SafetyCertificateOutlined,
  CheckCircleOutlined,
  CopyOutlined,
} from "@ant-design/icons";
import { useSpring, animated } from "@react-spring/web";
import { OtsViewerFromFile } from "../ots-viewer";
import { manifestAtomFamily } from "../../state/provenance";
import { ProvenanceModalProps } from "./types";

const { Text, Paragraph } = Typography;

export function ProvenanceModal({ onClose, file }: ProvenanceModalProps) {
  const [expandedHashes, setExpandedHashes] = useState<{
    [key: string]: boolean;
  }>({});
  const [isFlipped, setIsFlipped] = useState(false);
  const manifest = useAtomValue(manifestAtomFamily(file));

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

  const handleModalClose = () => {
    setIsFlipped(false); // Reset flip state when closing
    onClose();
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

    const isPending = manifest.artifact?.verified_height ? false : true;
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
            {!isPending ? (
              <CheckCircleOutlined className="text-green-500" />
            ) : (
              <ClockCircleOutlined className="text-orange-500" />
            )}
            <span>Bitcoin</span>
          </Space>
        ),
        children: manifest.artifact?.verified_timestamp
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
    const firstEvent = manifest.events?.[0];
    const creatorPubkey = firstEvent?.actors?.creator_pubkey_hex || "";
    const isPending = manifest.artifact?.verified_height ? false : true;

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
      {
        key: "bitcoin",
        label: "Bitcoin Block",
        children: isPending ? (
          <Tag color="warning" icon={<ClockCircleOutlined />}>
            Pending
          </Tag>
        ) : (
          <Tag color="success" icon={<CheckCircleOutlined />}>
            Block #{manifest.artifact?.verified_height}
          </Tag>
        ),
      },
      ...(file.type === "uploaded"
        ? [
            {
              key: "ots",
              label: "OTS Proof",
              children: (
                <Button
                  type="link"
                  size="small"
                  icon={<DownloadOutlined />}
                  href={`${window.location.pathname}${file.filePath}?ots`}
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
            <Suspense fallback={<Skeleton />}>
              <OtsViewerFromFile file={file} />
            </Suspense>
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
    <Modal
      open
      title={isFlipped ? `Provenance Details` : undefined}
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
  );
}
