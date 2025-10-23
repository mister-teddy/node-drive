import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
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

const { Title, Text, Paragraph } = Typography;
const { Content } = Layout;

interface ShareInfo {
  share_id: string;
  file_path: string;
  file_sha256_hex: string;
  created_at: string;
  shared_by: string | null;
  owner_pubkey_hex: string;
  share_signature_hex: string;
  is_active: boolean;
}

function SharePage() {
  const { shareId } = useParams<{ shareId: string }>();
  const navigate = useNavigate();
  const [shareInfo, setShareInfo] = useState<ShareInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (!shareId) {
      setError("Invalid share link");
      setLoading(false);
      return;
    }

    // Fetch share information
    fetch(`/share/${shareId}/info`)
      .then(async (res) => {
        if (!res.ok) {
          throw new Error("Share not found or expired");
        }
        return res.json();
      })
      .then((data: ShareInfo) => {
        setShareInfo(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message || "Failed to load share information");
        setLoading(false);
      });
  }, [shareId]);

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
      <Layout style={{ minHeight: "100vh", background: "#f5f5f5" }}>
        <Content
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            minHeight: "100vh",
          }}
        >
          <Spin size="large" tip="Loading share information..." />
        </Content>
      </Layout>
    );
  }

  if (error || !shareInfo) {
    return (
      <Layout style={{ minHeight: "100vh", background: "#f5f5f5" }}>
        <Content
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            minHeight: "100vh",
            padding: 24,
          }}
        >
          <Card style={{ maxWidth: 600, width: "100%" }}>
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
    <Layout style={{ minHeight: "100vh", background: "#f5f5f5" }}>
      <Content
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          minHeight: "100vh",
          padding: 24,
        }}
      >
        <Card
          style={{
            maxWidth: 800,
            width: "100%",
          }}
          styles={{ body: { padding: "32px 24px" } }}
        >
          {/* Header */}
          <div style={{ textAlign: "center", marginBottom: 32 }}>
            <FileOutlined
              style={{ fontSize: 64, color: "#1890ff", marginBottom: 16 }}
            />
            <Title level={2} style={{ marginBottom: 8 }}>
              {fileName}
            </Title>
            <Text type="secondary">Someone shared this file with you</Text>
            <div style={{ marginTop: 16 }}>
              <Provenance
                fileName={fileName}
                defaultMode="summary"
                isDir={false}
                stampStatus={{
                  success: true,
                  sha256_hex: shareInfo.file_sha256_hex,
                }}
                shareId={shareId}
              />
            </div>
          </div>

          <Descriptions column={1} size="small" bordered>
            <Descriptions.Item
              label={
                <Space>
                  <ClockCircleOutlined />
                  Shared On
                </Space>
              }
            >
              {sharedDate}
            </Descriptions.Item>
            <Descriptions.Item label="Share ID">
              <Text code copyable={{ text: shareInfo.share_id }}>
                {shareInfo.share_id}
              </Text>
            </Descriptions.Item>
            <Descriptions.Item label="File Hash (SHA-256)">
              <Text
                code
                copyable={{ text: shareInfo.file_sha256_hex }}
                style={{ fontSize: 12, wordBreak: "break-all" }}
              >
                {truncatedHash}
              </Text>
            </Descriptions.Item>
            <Descriptions.Item
              label={
                <Space>
                  <KeyOutlined />
                  Owner Public Key
                </Space>
              }
            >
              <Text
                code
                copyable={{ text: shareInfo.owner_pubkey_hex }}
                style={{ fontSize: 12, wordBreak: "break-all" }}
              >
                {truncatedPubkey}
              </Text>
            </Descriptions.Item>
          </Descriptions>

          {/* Footer */}
          <Divider />

          {/* Download Action */}
          <Space direction="vertical" size="large" className="w-full">
            <Row className="w-full" gutter={16}>
              <Col span={12}>
                <Button
                  size="large"
                  icon={<DollarOutlined />}
                  onClick={handlePayment}
                  className="w-full"
                >
                  Pay
                </Button>
              </Col>
              <Col span={12}>
                <Button
                  type="primary"
                  size="large"
                  icon={<DownloadOutlined />}
                  onClick={handleDownload}
                  loading={downloading}
                  className="w-full"
                >
                  Download
                </Button>
              </Col>
            </Row>

            <div style={{ textAlign: "center" }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
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
