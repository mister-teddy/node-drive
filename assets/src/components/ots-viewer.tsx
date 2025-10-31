import { Steps, Typography, Button, Space } from "antd";
import type { StepProps } from "antd";
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  FileTextOutlined,
  LinkOutlined,
  DownOutlined,
  UpOutlined,
} from "@ant-design/icons";
import { useState } from "react";
import { FileProps } from "../type";
import { useAtomValue } from "jotai";
import { otsInfoAtomFamily } from "../state/provenance";

const { Text } = Typography;

interface OtsInfo {
  file_hash: string;
  operations: string[];
}

interface OtsViewerProps {
  otsInfo: OtsInfo;
}

export default function OtsViewer({ otsInfo }: OtsViewerProps) {
  // Parse operations into steps
  const steps = parseOperationsToSteps(otsInfo.operations);

  return (
    <Space direction="vertical" className="w-full" size="large">
      {/* Visual Steps */}
      <Steps
        direction="vertical"
        size="small"
        current={steps.findIndex((s) => s.status === "process")}
        items={steps}
      />

      {/* Completion percentage for pending */}
      <div className="mt-4">
        <Text type="secondary" className="text-[11px]">
          Progress: {calculateCompletionPercentage(otsInfo.operations)}%
        </Text>
      </div>
    </Space>
  );
}

export function OtsViewerFromFile({ file }: { file: FileProps }) {
  const otsInfo = useAtomValue(otsInfoAtomFamily(file));
  return <OtsViewer otsInfo={otsInfo} />;
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
function parseOperationsToSteps(operations: string[]): StepProps[] {
  const steps: StepProps[] = [];

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
      status: "process",
      icon: <ClockCircleOutlined />,
    });
  }

  // Step 4: Bitcoin Blockchain
  const bitcoinOps = operations.filter((op) => op.includes("Bitcoin"));
  const hasBitcoin = bitcoinOps.length > 0;

  if (hasBitcoin) {
    steps.push({
      title: "Bitcoin Blockchain",
      description: (
        <Text type="secondary" className="text-[11px]">
          {bitcoinOps[0]}
        </Text>
      ),
      status: "finish",
      icon: <CheckCircleOutlined className="text-[#52c41a]" />,
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
