import { Alert, Steps, Typography, Spin, Button } from "antd";
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  FileTextOutlined,
  LinkOutlined,
  SafetyOutlined,
  DownOutlined,
  UpOutlined,
} from "@ant-design/icons";
import { useState } from "react";

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

interface OtsInfo {
  file_hash: string;
  operations: string[];
}

interface OtsViewerProps {
  otsInfo: OtsInfo | null;
  stampStatus?: StampStatus | string;
  isLoading?: boolean;
}

export default function OtsViewer({
  otsInfo,
  stampStatus,
  isLoading = false,
}: OtsViewerProps) {
  if (isLoading) {
    return (
      <div style={{ textAlign: "center", padding: "20px" }}>
        <Spin />
      </div>
    );
  }

  if (!otsInfo) {
    return (
      <Alert
        message="Timestamp proof not available"
        description="No timestamp proof found for this file."
        type="info"
        showIcon
        style={{ fontSize: 11 }}
      />
    );
  }

  const stampStatusObj = typeof stampStatus === "string" ? null : stampStatus;
  const isVerified = stampStatusObj?.success && stampStatusObj.results;

  // Parse operations into steps
  const steps = parseOperationsToSteps(otsInfo.operations, stampStatusObj);

  return (
    <div style={{ fontSize: 12 }}>
      {/* Status Alert */}
      {isVerified ? (
        <Alert
          message="Verified on Bitcoin Blockchain"
          description={`This file's timestamp was confirmed in Bitcoin block #${
            stampStatusObj?.results?.bitcoin.height
          } on ${new Date(
            (stampStatusObj?.results?.bitcoin.timestamp || 0) * 1000
          ).toLocaleString("en-US", {
            month: "long",
            day: "numeric",
            year: "numeric",
            hour: "numeric",
            minute: "numeric",
          })}. The proof below shows how your file connects to this block.`}
          type="success"
          showIcon
          style={{ fontSize: 11, marginBottom: 16 }}
        />
      ) : (
        <Alert
          message="⏳ Pending Bitcoin Confirmation"
          description="Your file has been submitted for timestamping. The proof will be complete once it's included in a Bitcoin block (usually within a few hours)."
          type="warning"
          showIcon
          style={{ fontSize: 11, marginBottom: 16 }}
        />
      )}

      {/* Visual Steps */}
      <Steps
        direction="vertical"
        size="small"
        current={steps.findIndex((s) => s.status === "process")}
        items={steps}
      />

      {/* Completion percentage for pending */}
      {!isVerified && (
        <div style={{ marginTop: 16 }}>
          <Text type="secondary" style={{ fontSize: 11 }}>
            Progress: {calculateCompletionPercentage(otsInfo.operations)}%
          </Text>
        </div>
      )}

      {/* Explanation */}
      {isVerified ? (
        <Alert
          message="What does this mean?"
          description={`This proof is permanent and cryptographically verifiable. Anyone can confirm that this exact file existed on ${new Date(
            (stampStatusObj?.results?.bitcoin.timestamp || 0) * 1000
          ).toLocaleDateString("en-US", {
            month: "long",
            day: "numeric",
            year: "numeric",
          })} by checking Bitcoin block #${
            stampStatusObj?.results?.bitcoin.height
          }.`}
          type="info"
          showIcon
          style={{ fontSize: 11, marginTop: 16 }}
        />
      ) : (
        <Alert
          message="What happens next?"
          description="Once your timestamp is included in a Bitcoin block, you'll see a green checkmark above. The pending calendar servers shown above are collecting timestamps to batch them into the blockchain."
          type="info"
          showIcon
          style={{ fontSize: 11, marginTop: 16 }}
        />
      )}
    </div>
  );
}

/**
 * Merkle Tree Operations Component with expand/collapse
 */
function MerkleTreeOperations({ operations }: { operations: string[] }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div>
      <Text type="secondary" style={{ fontSize: 11 }}>
        Combining with other timestamps via hashing
      </Text>
      <div style={{ marginTop: 4 }}>
        <Button
          type="link"
          size="small"
          onClick={() => setExpanded(!expanded)}
          icon={expanded ? <UpOutlined /> : <DownOutlined />}
          style={{ padding: 0, fontSize: 10, height: "auto" }}
        >
          {operations.length} operations
        </Button>
        {expanded && (
          <div
            style={{
              fontSize: 9,
              marginTop: 8,
              maxHeight: "300px",
              overflow: "auto",
              background: "#f5f5f5",
              padding: 8,
              borderRadius: 4,
              fontFamily: "monospace",
            }}
          >
            {operations.map((op, idx) => (
              <div
                key={idx}
                style={{
                  padding: "2px 0",
                  borderBottom:
                    idx < operations.length - 1 ? "1px solid #e8e8e8" : "none",
                }}
              >
                {op}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Parse OTS operations into Steps format
 */
function parseOperationsToSteps(
  operations: string[],
  stampStatus?: StampStatus | null
): any[] {
  const steps: any[] = [];
  const isVerified = stampStatus?.success && stampStatus.results;

  // Step 1: File Hash
  const fileHash = operations[0] || "";
  steps.push({
    title: "Your File",
    description: (
      <div>
        <Text type="secondary" style={{ fontSize: 11 }}>
          Starting with file's unique fingerprint (SHA-256)
        </Text>
        <br />
        <Text
          code
          style={{
            fontSize: 10,
            wordBreak: "break-all",
            display: "block",
            marginTop: 4,
          }}
        >
          {fileHash}
        </Text>
      </div>
    ),
    status: "finish",
    icon: <FileTextOutlined />,
  });

  // Step 2: Cryptographic Operations
  const cryptoOps = operations.filter(
    (op) =>
      (op.includes("sha256") ||
        op.includes("append") ||
        op.includes("prepend")) &&
      !op.includes("Bitcoin") &&
      !op.includes("Pending")
  );

  if (cryptoOps.length > 0) {
    steps.push({
      title: "Merkle Tree Operations",
      description: <MerkleTreeOperations operations={cryptoOps} />,
      status: "finish",
      icon: <LinkOutlined />,
    });
  }

  // Step 3: Calendar Servers / Pending
  const pendingOps = operations.filter((op) => op.includes("Pending"));
  const hasPending = pendingOps.length > 0;

  if (hasPending) {
    steps.push({
      title: "Calendar Servers",
      description: (
        <div>
          <Text type="secondary" style={{ fontSize: 11 }}>
            Aggregating timestamps before blockchain submission
          </Text>
          <div style={{ fontSize: 10, marginTop: 4, color: "#fa8c16" }}>
            {pendingOps.map((op, idx) => (
              <div key={idx}>{op.replace("⏳ ", "")}</div>
            ))}
          </div>
        </div>
      ),
      status: isVerified ? "finish" : "process",
      icon: <ClockCircleOutlined />,
    });
  }

  // Step 4: Bitcoin Blockchain
  const bitcoinOps = operations.filter((op) => op.includes("Bitcoin"));
  const hasBitcoin = bitcoinOps.length > 0;

  if (hasBitcoin || isVerified) {
    steps.push({
      title: "Bitcoin Blockchain",
      description: (
        <div>
          {isVerified ? (
            <>
              <Text type="secondary" style={{ fontSize: 11 }}>
                Permanently recorded in block #
                {stampStatus?.results?.bitcoin.height}
              </Text>
              <br />
              <Text strong style={{ fontSize: 11, color: "#52c41a" }}>
                {new Date(
                  (stampStatus?.results?.bitcoin.timestamp || 0) * 1000
                ).toLocaleString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                  hour: "numeric",
                  minute: "numeric",
                })}
              </Text>
            </>
          ) : (
            <Text type="secondary" style={{ fontSize: 11 }}>
              Waiting for inclusion in a Bitcoin block
            </Text>
          )}
        </div>
      ),
      status: isVerified ? "finish" : "wait",
      icon: isVerified ? (
        <CheckCircleOutlined style={{ color: "#52c41a" }} />
      ) : (
        <SafetyOutlined />
      ),
    });
  }

  return steps;
}

/**
 * Calculate completion percentage for pending timestamps
 */
function calculateCompletionPercentage(operations: string[]): number {
  const bitcoinConfirmed = operations.some((op) => op.includes("✓ Bitcoin"));
  const hasPending = operations.some((op) => op.includes("Pending"));
  const hasOperations = operations.some(
    (op) =>
      op.includes("sha256") || op.includes("append") || op.includes("prepend")
  );

  if (bitcoinConfirmed) return 100;
  if (hasPending && hasOperations) return 75;
  if (hasOperations) return 50;
  return 25;
}
