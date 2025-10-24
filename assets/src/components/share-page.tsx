import { useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAtomValue } from "jotai";
import { loadable } from "jotai/utils";
import {
  Layout,
  Card,
  Button,
  Typography,
  Spin,
  Space,
  Descriptions,
  Divider,
  Alert,
  Modal,
  message,
  Result,
  Row,
  Col,
} from "antd";
import {
  DownloadOutlined,
  DollarOutlined,
  FileOutlined,
  ClockCircleOutlined,
  KeyOutlined,
  HomeOutlined,
} from "@ant-design/icons";
import Provenance from "./provenance";
import { shareInfoAtomFamily } from "../state";

const { Title, Text, Paragraph } = Typography;
const { Content } = Layout;

function SharePage() {
  const { shareId } = useParams<{ shareId: string }>();
  const navigate = useNavigate();

  // Create loadable atom for share info
  const shareInfoAtom = useMemo(
    () => shareId ? loadable(shareInfoAtomFamily(shareId)) : null,
    [shareId]
  );

  const shareInfoLoadable = shareInfoAtom ? useAtomValue(shareInfoAtom) : null;

  // Derive state from loadable
  const loading = !shareId || shareInfoLoadable?.state === "loading";
  const error = !shareId
    ? "Invalid share link"
    : shareInfoLoadable?.state === "hasError"
      ? (shareInfoLoadable.error as Error).message || "Failed to load share information"
      : null;
  const shareInfo = shareInfoLoadable?.state === "hasData" ? shareInfoLoadable.data : null;

  const [downloading, setDownloading] = useState(false);

  const handleDownload = () => {
    if (!shareId) return;

    setDownloading(true);

    // Trigger download
    window.location.href = `/share/${shareId}/download`;

    // Reset downloading state after a delay
    message.success("Download started!");
    setTimeout(() => {
      setDownloading(false);
    }, 1000);
  };

  const handlePayment = () => {
    Modal.info({
      title: "Payment Integration Coming Soon",
      icon: <DollarOutlined style={{ color: "#1890ff" }} />,
      content: (
        <div>
          <Paragraph>
            This feature will allow you to support the file creator by making a
            payment.
          </Paragraph>
          <Paragraph strong>Planned Payment Methods:</Paragraph>
          <ul style={{ marginLeft: 20 }}>
            <li>Lightning Network (Bitcoin)</li>
          </ul>
          <Alert
            message="For now, you can download the file for free using the Download button."
            type="info"
            showIcon
            style={{ marginTop: 16 }}
          />
        </div>
      ),
      okText: "Got it",
      width: 520,
    });
  };

  if (loading) {
    return (
      <Layout className="min-h-screen bg-gray-100">
        <Content className="flex justify-center items-center min-h-screen">
          <Spin size="large" tip="Loading share information..." />
        </Content>
      </Layout>
    );
  }

  if (error || !shareInfo) {
    return (
      <Layout className="min-h-screen bg-gray-100">
        <Content className="flex justify-center items-center min-h-screen p-6">
          <Card className="max-w-2xl w-full">
            <Result
              status="error"
              title="Share Not Found"
              subTitle={error || "This share link is invalid or has expired."}
              extra={
                <Button
                  type="primary"
                  icon={<HomeOutlined />}
                  onClick={() => navigate("/")}
                >
                  Go to Home
                </Button>
              }
            />
          </Card>
        </Content>
      </Layout>
    );
  }

  const fileName = shareInfo.file_path.split("/").pop() || "Unknown File";
  const sharedDate = new Date(shareInfo.created_at).toLocaleString();
  const truncatedHash = `${shareInfo.file_sha256_hex.slice(
    0,
    16
  )}...${shareInfo.file_sha256_hex.slice(-16)}`;
  const truncatedPubkey = `${shareInfo.owner_pubkey_hex.slice(
    0,
    16
  )}...${shareInfo.owner_pubkey_hex.slice(-16)}`;

  return (
    <Layout className="min-h-screen bg-gray-100">
      <Content className="flex justify-center items-center min-h-screen px-3 py-4">
        <Card className="max-w-3xl w-full" styles={{ body: { padding: "24px 16px" } }}>
          {/* Header */}
          <div className="text-center mb-6">
            <FileOutlined className="text-5xl text-blue-500 mb-3" />
            <Title
              level={2}
              className="mb-2 text-xl sm:text-2xl md:text-3xl break-words hyphens-auto"
            >
              {fileName}
            </Title>
            <Text type="secondary" className="text-xs sm:text-sm">
              Someone shared this file with you
            </Text>
            <div className="mt-3">
              <Provenance
                fileName={fileName}
                defaultMode="summary"
                isDir={false}
                stampStatus={shareInfo.stamp_status}
                shareId={shareId}
              />
            </div>
          </div>

          <Descriptions
            column={1}
            size="small"
            bordered
            labelStyle={{ fontSize: "0.75rem" }}
            contentStyle={{ fontSize: "0.75rem" }}
          >
            <Descriptions.Item
              label={
                <Space size={4}>
                  <ClockCircleOutlined className="text-xs" />
                  <span>Shared On</span>
                </Space>
              }
            >
              {sharedDate}
            </Descriptions.Item>
            <Descriptions.Item label="Share ID">
              <Text code copyable={{ text: shareInfo.share_id }} className="text-[10px]">
                {shareInfo.share_id}
              </Text>
            </Descriptions.Item>
            <Descriptions.Item label="File Hash (SHA-256)">
              <Text
                code
                copyable={{ text: shareInfo.file_sha256_hex }}
                className="text-[10px] break-all block"
              >
                {truncatedHash}
              </Text>
            </Descriptions.Item>
            <Descriptions.Item
              label={
                <Space size={4}>
                  <KeyOutlined className="text-xs" />
                  <span>Owner Public Key</span>
                </Space>
              }
            >
              <Text
                code
                copyable={{ text: shareInfo.owner_pubkey_hex }}
                className="text-[10px] break-all block"
              >
                {truncatedPubkey}
              </Text>
            </Descriptions.Item>
          </Descriptions>

          {/* Footer */}
          <Divider className="my-5" />

          {/* Download Action */}
          <Space direction="vertical" size="middle" className="w-full">
            <Row gutter={[8, 8]} className="w-full">
              <Col xs={24} sm={12}>
                <Button
                  size="large"
                  icon={<DollarOutlined />}
                  onClick={handlePayment}
                  block
                  className="h-12"
                >
                  Pay
                </Button>
              </Col>
              <Col xs={24} sm={12}>
                <Button
                  type="primary"
                  size="large"
                  icon={<DownloadOutlined />}
                  onClick={handleDownload}
                  loading={downloading}
                  block
                  className="h-12"
                >
                  Download
                </Button>
              </Col>
            </Row>

            <div className="text-center py-2">
              <Text type="secondary" className="text-[10px] sm:text-xs">
                Secured by{" "}
                <a
                  href="/"
                  onClick={(e) => {
                    e.preventDefault();
                    navigate("/");
                  }}
                >
                  Node Drive
                </a>{" "}
                with Bitcoin-backed provenance
              </Text>
            </div>
          </Space>
        </Card>
      </Content>
    </Layout>
  );
}

export default SharePage;
