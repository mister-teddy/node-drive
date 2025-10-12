import { useState } from 'react';
import { Tag, Modal, Button, Spin, Card, Space, Typography, Descriptions } from 'antd';
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  DownloadOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import { formatHashShort } from '../utils';

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

  const handleModalOpen = () => {
    if (!manifest && !isLoading) {
      fetchProvenanceData();
    }
    setIsModalVisible(true);
  };

  // Render summary view
  const renderSummary = () => {
    if (isLoading) {
      return <Spin size="small" />;
    }

    // Show stamp if we have stampStatus
    if (
      !stampStatus &&
      (!manifest || !manifest.events || manifest.events.length === 0)
    ) {
      return <Text type="secondary" style={{ fontSize: 11 }}>—</Text>;
    }

    const stampStatusObj = typeof stampStatus === 'string' ? null : stampStatus;

    return (
      <div onClick={handleModalOpen} style={{ cursor: 'pointer' }}>
        <Tag
          icon={isPending ? <ClockCircleOutlined /> : <CheckCircleOutlined />}
          color={isPending ? 'warning' : 'success'}
          style={{
            fontSize: '11px',
            padding: '4px 8px',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
          }}
        >
          <SafetyCertificateOutlined />
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
            <Text strong style={{ fontSize: '10px', color: 'inherit' }}>
              {isPending ? 'PENDING' : 'VERIFIED'}
            </Text>
            {(stampStatusObj?.sha256_hex || manifest?.artifact?.sha256_hex) && (
              <Text code style={{ fontSize: '8px', padding: '0 2px' }}>
                {formatHashShort(stampStatusObj?.sha256_hex || manifest?.artifact?.sha256_hex || "")}•
              </Text>
            )}
          </div>
        </Tag>
      </div>
    );
  };

  // Render full view in modal
  const renderFullView = () => {
    if (!manifest) return null;

    const hash = manifest.artifact?.sha256_hex || "";
    const stampStatusObj = typeof stampStatus === 'string' ? null : stampStatus;

    return (
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        {/* File fingerprint */}
        <Card size="small" title="Digital Fingerprint (SHA-256)">
          <Paragraph
            copyable
            code
            style={{ fontSize: '11px', wordBreak: 'break-all', margin: 0 }}
          >
            {hash}
          </Paragraph>
        </Card>

        {/* Bitcoin Verification Status */}
        {stampStatusObj && (
          <Card size="small" title="OpenTimestamps Verification">
            <Space direction="vertical" style={{ width: '100%' }}>
              <Tag
                icon={stampStatusObj.success ? <CheckCircleOutlined /> : <ClockCircleOutlined />}
                color={stampStatusObj.success ? 'success' : 'warning'}
              >
                {stampStatusObj.success ? 'Verified' : 'Pending Confirmation'}
              </Tag>
              {stampStatusObj.success && stampStatusObj.results && (
                <Text style={{ fontSize: '12px' }}>
                  Bitcoin block <Text strong>{stampStatusObj.results.bitcoin.height}</Text> attests
                  existence as of{' '}
                  <Text strong>
                    {new Date(stampStatusObj.results.bitcoin.timestamp * 1000).toLocaleDateString(undefined, {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                    })}
                  </Text>
                </Text>
              )}
            </Space>
          </Card>
        )}

        {/* Events list */}
        {manifest.events && manifest.events.length > 0 ? (
          <Card
            size="small"
            title={`Provenance Events (${manifest.events.length})`}
            extra={
              <Text type="secondary" style={{ fontSize: 11 }}>
                This shows the file has existed since this date
              </Text>
            }
          >
            <Space direction="vertical" size="middle" style={{ width: '100%' }}>
              {manifest.events.map((event: ProvenanceEvent, eventIndex: number) => (
                <Card key={eventIndex} type="inner" size="small">
                  <Descriptions column={1} size="small" labelStyle={{ fontWeight: 600 }}>
                    <Descriptions.Item label="Action">
                      <Tag color={event.action === 'mint' ? 'green' : 'blue'}>
                        {event.action.toUpperCase()}
                      </Tag>
                    </Descriptions.Item>
                    <Descriptions.Item label="Timestamp">
                      {new Date(event.issued_at).toLocaleString()}
                    </Descriptions.Item>
                    <Descriptions.Item label="Actor">
                      <Text code style={{ fontSize: '9px' }}>
                        {event.actors?.creator_pubkey_hex?.slice(0, 16) ||
                          event.actors?.new_owner_pubkey_hex?.slice(0, 16) ||
                          'Unknown'}
                      </Text>
                    </Descriptions.Item>
                    <Descriptions.Item label="Signature">
                      <Text code style={{ fontSize: '9px' }}>
                        {(
                          event.signatures?.creator_sig_hex ||
                          event.signatures?.new_owner_sig_hex ||
                          'N/A'
                        ).slice(0, 32)}
                      </Text>
                    </Descriptions.Item>
                    <Descriptions.Item label="OpenTimestamps">
                      <Space>
                        <Text style={{ fontSize: '10px', color: isPending ? '#fa8c16' : '#52c41a' }}>
                          {stampStatusObj?.success
                            ? `Block ${stampStatusObj.results?.bitcoin.height} (${new Date(
                                (stampStatusObj.results?.bitcoin.timestamp ?? 0) * 1000
                              ).toLocaleDateString()})`
                            : '⏳ Pending Bitcoin confirmation...'}
                        </Text>
                        {event.ots_proof_b64 && event.ots_proof_b64 !== 'N/A' && (
                          <Button
                            type="link"
                            size="small"
                            icon={<DownloadOutlined />}
                            href={`${window.location.pathname}${fileName}?ots`}
                            download
                          >
                            Download Proof
                          </Button>
                        )}
                      </Space>
                    </Descriptions.Item>
                    {event.prev_event_hash_hex && (
                      <Descriptions.Item label="Previous Event Hash">
                        <Text code style={{ fontSize: '9px' }}>
                          {event.prev_event_hash_hex.slice(0, 16)}...
                        </Text>
                      </Descriptions.Item>
                    )}
                  </Descriptions>
                </Card>
              ))}
            </Space>
          </Card>
        ) : (
          <Card size="small">
            <Text type="secondary" italic>
              No provenance events recorded
            </Text>
          </Card>
        )}

        {/* JSON Manifest info */}
        {manifest && (
          <Card size="small" title="Manifest Information">
            <Space direction="vertical">
              <Button
                type="link"
                href={`${window.location.pathname}${fileName}?manifest=json`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ padding: 0 }}
              >
                📄 {manifest.type || 'provenance.manifest/v1'}
              </Button>
              <Text style={{ fontSize: '11px' }}>
                This is a JSON manifest storing the file's fingerprint and an append-only list of
                signed events (mint, transfers), each with its own OpenTimestamps proof anchored
                to the Bitcoin blockchain.
              </Text>
            </Space>
          </Card>
        )}
      </Space>
    );
  };

  return (
    <>
      {renderSummary()}
      <Modal
        title="Cryptographic Details"
        open={isModalVisible}
        onCancel={() => setIsModalVisible(false)}
        footer={null}
        width={800}
        styles={{ body: { maxHeight: '70vh', overflow: 'auto' } }}
      >
        {isLoading ? (
          <div style={{ textAlign: 'center', padding: '40px' }}>
            <Spin size="large" />
          </div>
        ) : (
          renderFullView()
        )}
      </Modal>
    </>
  );
}
