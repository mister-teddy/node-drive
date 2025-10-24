import { Alert, Steps, Typography, Spin, Button, Space } from "antd";
import type { StepProps } from "antd";
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
      <div className="text-center p-5">
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
        className="text-[11px]"
      />
    );
  }

  const stampStatusObj = typeof stampStatus === "string" ? null : stampStatus;
  const isVerified = stampStatusObj?.success && stampStatusObj.results;

  // Parse operations into steps
  const steps = parseOperationsToSteps(otsInfo.operations, stampStatusObj);

  return (
    <Space direction="vertical" className="w-full" size="large">
      {/* Status Alert */}
      {isVerified ? (
        <Alert
          message="Verified on Bitcoin Blockchain"
          description={`This proof is permanent and cryptographically verifiable. Anyone can confirm that this exact file existed on ${new Date(
            (stampStatusObj?.results?.bitcoin.timestamp || 0) * 1000
          ).toLocaleDateString("en-US", {
            month: "long",
            day: "numeric",
            year: "numeric",
          })} by checking Bitcoin block #${
            stampStatusObj?.results?.bitcoin.height
          }.`}
          type="success"
          showIcon
          className="text-xs mb-4"
        />
      ) : (
        <Alert
          message="⏳ Pending Bitcoin Confirmation"
          description="Your file has been submitted for timestamping. The proof will be complete once it's included in a Bitcoin block (usually within a few hours). Once your timestamp is included in a Bitcoin block, you'll see a green checkmark above. The pending calendar servers shown above are collecting timestamps to batch them into the blockchain."
          type="warning"
          showIcon
          className="text-xs mb-4"
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
        <div className="mt-4">
          <Text type="secondary" className="text-[11px]">
            Progress: {calculateCompletionPercentage(otsInfo.operations)}%
          </Text>
        </div>
      )}
    </Space>
  );
}

/**
 * Merkle Tree Operations Component with expand/collapse
 */
function MerkleTreeOperations({ operations }: { operations: string[] }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div>
      <Text type="secondary" className="text-[11px]">
        Combining with other timestamps via hashing
      </Text>
      <div className="mt-1">
        <Button
          type="link"
          size="small"
          onClick={() => setExpanded(!expanded)}
          icon={expanded ? <UpOutlined /> : <DownOutlined />}
          className="p-0 text-[10px] h-auto"
        >
          {operations.length} operations
        </Button>
        {expanded && (
          <div className="text-[9px] mt-2 max-h-[300px] overflow-auto bg-gray-100 p-2 rounded font-mono">
            {operations.map((op, idx) => (
              <div
                key={idx}
                className={`py-0.5 ${
                  idx < operations.length - 1 ? "border-b border-gray-200" : ""
                }`}
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
): StepProps[] {
  const steps: StepProps[] = [];
  const isVerified = stampStatus?.success && stampStatus.results;

  // Step 1: File Hash
  steps.push({
    title: "Your File",
    description: (
      <Text type="secondary" className="text-[11px]">
        Starting with file's unique fingerprint (SHA-256)
      </Text>
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
          <Text type="secondary" className="text-[11px]">
            Aggregating timestamps before blockchain submission
          </Text>
          <div className="text-[10px] mt-1 text-[#fa8c16]">
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
              <Text type="secondary" className="text-[11px]">
                Permanently recorded in block #
                {stampStatus?.results?.bitcoin.height}
              </Text>
              <br />
              <Text strong className="text-[11px] text-[#52c41a]">
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
            <Text type="secondary" className="text-[11px]">
              Waiting for inclusion in a Bitcoin block
            </Text>
          )}
        </div>
      ),
      status: isVerified ? "finish" : "wait",
      icon: isVerified ? (
        <CheckCircleOutlined className="text-[#52c41a]" />
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
