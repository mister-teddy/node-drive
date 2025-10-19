import { Drawer, Button, Space, Typography, Spin, Image, Alert } from "antd";
import {
  DownloadOutlined,
  CloseOutlined,
  FileTextOutlined,
  FileImageOutlined,
  FilePdfOutlined,
  FileOutlined,
} from "@ant-design/icons";
import { useState, useEffect } from "react";
import { apiPath } from "../utils";

const { Title, Text, Paragraph } = Typography;

interface FilePreviewDrawerProps {
  open: boolean;
  fileName: string | null;
  onClose: () => void;
}

export default function FilePreviewDrawer({
  open,
  fileName,
  onClose,
}: FilePreviewDrawerProps) {
  const [loading, setLoading] = useState(false);
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fileUrl = fileName ? apiPath(fileName) : "";
  const fileExt = fileName?.split(".").pop()?.toLowerCase() || "";

  // Determine file type
  const isImage = [
    "jpg",
    "jpeg",
    "png",
    "gif",
    "svg",
    "webp",
    "bmp",
    "ico",
  ].includes(fileExt);
  const isPdf = fileExt === "pdf";
  const isText = [
    "txt",
    "md",
    "markdown",
    "json",
    "xml",
    "yaml",
    "yml",
    "log",
    "js",
    "jsx",
    "ts",
    "tsx",
    "css",
    "scss",
    "html",
    "py",
    "java",
    "c",
    "cpp",
    "h",
    "go",
    "rs",
    "sh",
    "bash",
    "toml",
    "ini",
    "conf",
  ].includes(fileExt);
  const isVideo = ["mp4", "webm", "ogg", "mov"].includes(fileExt);
  const isAudio = ["mp3", "wav", "ogg", "m4a", "flac"].includes(fileExt);

  useEffect(() => {
    if (!open || !fileName) {
      setContent(null);
      setError(null);
      return;
    }

    // For text files, fetch and display content
    if (isText) {
      setLoading(true);
      fetch(fileUrl)
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.text();
        })
        .then((text) => {
          setContent(text);
          setError(null);
        })
        .catch((err) => {
          setError(`Failed to load file: ${err.message}`);
        })
        .finally(() => {
          setLoading(false);
        });
    }
  }, [open, fileName, fileUrl, isText]);

  const renderPreview = () => {
    if (loading) {
      return (
        <div style={{ textAlign: "center", padding: "60px 20px" }}>
          <Spin size="large" />
          <div style={{ marginTop: 16 }}>
            <Text type="secondary">Loading preview...</Text>
          </div>
        </div>
      );
    }

    if (error) {
      return (
        <Alert
          message="Preview Error"
          description={error}
          type="error"
          showIcon
          style={{ margin: "20px 0" }}
        />
      );
    }

    // Image preview
    if (isImage) {
      return (
        <div style={{ textAlign: "center", padding: "20px 0" }}>
          <Image
            src={fileUrl}
            alt={fileName || ""}
            style={{ maxWidth: "100%" }}
            preview={{
              mask: "Click to enlarge",
            }}
          />
        </div>
      );
    }

    // PDF preview
    if (isPdf) {
      return (
        <iframe
          src={fileUrl}
          style={{
            width: "100%",
            height: "100%",
            border: "none",
            borderRadius: "4px",
          }}
          title={fileName || "PDF Preview"}
        />
      );
    }

    // Text file preview
    if (isText && content) {
      return (
        <div
          style={{
            backgroundColor: "#f5f5f5",
            padding: "16px",
            borderRadius: "4px",
            border: "1px solid #e8e8e8",
            overflow: "auto",
          }}
        >
          <pre
            style={{
              margin: 0,
              fontFamily: "monospace",
              fontSize: "13px",
              lineHeight: "1.6",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {content}
          </pre>
        </div>
      );
    }

    // Video preview
    if (isVideo) {
      return (
        <div style={{ padding: "20px 0" }}>
          <video
            src={fileUrl}
            controls
            style={{
              width: "100%",
              borderRadius: "4px",
              backgroundColor: "#000",
            }}
          >
            Your browser does not support the video tag.
          </video>
        </div>
      );
    }

    // Audio preview
    if (isAudio) {
      return (
        <div style={{ padding: "40px 20px", textAlign: "center" }}>
          <div style={{ marginBottom: 24 }}>
            <FileOutlined style={{ fontSize: 64, color: "#d9d9d9" }} />
          </div>
          <audio
            src={fileUrl}
            controls
            style={{ width: "100%", maxWidth: "500px" }}
          >
            Your browser does not support the audio tag.
          </audio>
        </div>
      );
    }

    // Unsupported file type
    return (
      <div style={{ textAlign: "center", padding: "60px 20px" }}>
        <div style={{ marginBottom: 24 }}>
          {isPdf && (
            <FilePdfOutlined style={{ fontSize: 64, color: "#ff4d4f" }} />
          )}
          {isImage && (
            <FileImageOutlined style={{ fontSize: 64, color: "#52c41a" }} />
          )}
          {isText && (
            <FileTextOutlined style={{ fontSize: 64, color: "#1890ff" }} />
          )}
          {!isPdf && !isImage && !isText && (
            <FileOutlined style={{ fontSize: 64, color: "#d9d9d9" }} />
          )}
        </div>
        <Title level={4}>Preview not available</Title>
        <Paragraph type="secondary">
          This file type cannot be previewed. Download the file to view it.
        </Paragraph>
        <Button
          type="primary"
          icon={<DownloadOutlined />}
          href={fileUrl}
          download
          size="large"
        >
          Download File
        </Button>
      </div>
    );
  };

  const getFileIcon = () => {
    if (isImage) return <FileImageOutlined style={{ color: "#52c41a" }} />;
    if (isPdf) return <FilePdfOutlined style={{ color: "#ff4d4f" }} />;
    if (isText) return <FileTextOutlined style={{ color: "#1890ff" }} />;
    return <FileOutlined style={{ color: "#8c8c8c" }} />;
  };

  return (
    <Drawer
      title={
        <Space>
          {getFileIcon()}
          <span>{fileName}</span>
        </Space>
      }
      placement="right"
      width={Math.min(window.innerWidth * 0.8, 1000)}
      onClose={onClose}
      open={open}
      closeIcon={<CloseOutlined />}
      extra={
        <Space>
          <Button
            type="text"
            icon={<DownloadOutlined />}
            href={fileUrl}
            download
          >
            Download
          </Button>
          <Button
            type="text"
            icon={<FileOutlined />}
            href={fileUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open in New Tab
          </Button>
        </Space>
      }
      styles={{
        body: {
          padding: "16px 24px",
        },
      }}
    >
      {renderPreview()}
    </Drawer>
  );
}
