import { useState } from 'react';
import { Table, Button, Space, Empty, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  FolderOutlined,
  FileOutlined,
  FileTextOutlined,
  FileImageOutlined,
  FileZipOutlined,
  FileMarkdownOutlined,
  DownloadOutlined,
  DeleteOutlined,
  DragOutlined,
} from '@ant-design/icons';
import { formatMtime, formatFileSize, formatDirSize } from '../utils';
import Provenance from './provenance';

export interface PathItem {
  path_type: "Dir" | "SymlinkDir" | "File" | "SymlinkFile";
  name: string;
  mtime: number;
  size: number;
  sha256?: string;
  provenance?: {
    events: Array<Record<string, unknown>>;
  };
  stamp_status?: {
    success: boolean;
    results?: {
      bitcoin: {
        timestamp: number;
        height: number;
      };
    };
    error?: string;
    sha256_hex?: string;
  };
}

interface DATA {
  paths: PathItem[];
  allow_upload: boolean;
  allow_delete: boolean;
  allow_archive: boolean;
  user: string;
  uri_prefix?: string;
}

interface FilesTableProps {
  DATA: DATA;
}

export default function FilesTable({ DATA }: FilesTableProps) {
  const [paths, setPaths] = useState(DATA.paths || []);

  const newUrl = (name: string): string => {
    const href = window.location.href.split("?")[0];
    if (!href.endsWith("/")) {
      return href + "/" + encodeURIComponent(name);
    }
    return href + encodeURIComponent(name);
  };

  const getFileIcon = (file: PathItem) => {
    const isDir = file.path_type.endsWith("Dir");
    if (isDir) {
      return <FolderOutlined style={{ fontSize: '18px', color: '#1890ff' }} />;
    }

    const ext = file.name.split('.').pop()?.toLowerCase() || '';

    // Images
    if (['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp', 'bmp'].includes(ext)) {
      return <FileImageOutlined style={{ fontSize: '18px', color: '#52c41a' }} />;
    }
    // Archives
    if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) {
      return <FileZipOutlined style={{ fontSize: '18px', color: '#fa8c16' }} />;
    }
    // Markdown
    if (['md', 'markdown'].includes(ext)) {
      return <FileMarkdownOutlined style={{ fontSize: '18px', color: '#722ed1' }} />;
    }
    // Text
    if (['txt', 'json', 'xml', 'yaml', 'yml'].includes(ext)) {
      return <FileTextOutlined style={{ fontSize: '18px', color: '#8c8c8c' }} />;
    }

    return <FileOutlined style={{ fontSize: '18px', color: '#d9d9d9' }} />;
  };

  const renderVerificationStamps = (file: PathItem) => {
    return (
      <Provenance
        fileName={file.name}
        defaultMode="summary"
        isDir={false}
        stampStatus={file.stamp_status}
      />
    );
  };

  const handleDelete = async (file: PathItem) => {
    if (!confirm(`Delete "${file.name}"?`)) return;

    try {
      const url = newUrl(file.name);
      const res = await fetch(url, {
        method: "DELETE",
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      const newPaths = paths.filter(p => p.name !== file.name);
      setPaths(newPaths);
    } catch (err) {
      const error = err as Error;
      alert(`Cannot delete "${file.name}": ${error.message}`);
    }
  };

  const handleMove = async (file: PathItem) => {
    const fileUrl = newUrl(file.name);
    const fileUrlObj = new URL(fileUrl);
    const prefix = DATA.uri_prefix?.slice(0, -1) || "";
    const filePath = decodeURIComponent(fileUrlObj.pathname.slice(prefix.length));

    let newPath = prompt("Enter new path", filePath);
    if (!newPath) return;
    if (!newPath.startsWith("/")) newPath = "/" + newPath;
    if (filePath === newPath) return;

    const newFileUrl =
      fileUrlObj.origin +
      prefix +
      newPath.split("/").map(encodeURIComponent).join("/");

    try {
      const res1 = await fetch(newFileUrl, {
        method: "HEAD",
      });
      if (res1.status === 200) {
        if (!confirm("Override existing file?")) {
          return;
        }
      }

      const res2 = await fetch(fileUrl, {
        method: "MOVE",
        headers: {
          Destination: newFileUrl,
        },
      });

      if (!res2.ok) {
        throw new Error(`HTTP ${res2.status}: ${res2.statusText}`);
      }

      location.reload();
    } catch (err) {
      const error = err as Error;
      alert(`Cannot move "${filePath}" to "${newPath}": ${error.message}`);
    }
  };

  const columns: ColumnsType<PathItem> = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      render: (name: string, file: PathItem) => {
        const isDir = file.path_type.endsWith("Dir");
        const url = newUrl(file.name) + (isDir ? "/" : "");

        return (
          <Space>
            {getFileIcon(file)}
            <a
              href={url}
              target={isDir ? undefined : "_blank"}
              style={{ color: '#1890ff', fontWeight: 500 }}
            >
              {name}
            </a>
          </Space>
        );
      },
    },
    {
      title: 'Verification',
      key: 'verification',
      width: 150,
      render: (_: unknown, file: PathItem) => {
        const isDir = file.path_type.endsWith("Dir");
        return !isDir ? renderVerificationStamps(file) : null;
      },
    },
    {
      title: 'Size',
      key: 'size',
      width: 120,
      render: (_: unknown, file: PathItem) => {
        const isDir = file.path_type.endsWith("Dir");
        const sizeDisplay = isDir
          ? formatDirSize(file.size)
          : formatFileSize(file.size).join(" ");
        return <span style={{ color: '#8c8c8c' }}>{sizeDisplay}</span>;
      },
    },
    {
      title: 'Modified',
      dataIndex: 'mtime',
      key: 'mtime',
      width: 180,
      render: (mtime: number) => (
        <span style={{ color: '#8c8c8c' }}>{formatMtime(mtime)}</span>
      ),
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 150,
      render: (_: unknown, file: PathItem) => {
        const isDir = file.path_type.endsWith("Dir");
        const url = newUrl(file.name) + (isDir ? "/" : "");

        return (
          <Space>
            <Tooltip title={isDir ? "Download folder as zip" : "Download file"}>
              <Button
                type="text"
                icon={<DownloadOutlined />}
                href={url + (isDir && DATA.allow_archive ? "?zip" : "")}
                download
                size="small"
              />
            </Tooltip>

            {DATA.allow_upload && DATA.allow_delete && (
              <Tooltip title="Move to new path">
                <Button
                  type="text"
                  icon={<DragOutlined />}
                  onClick={() => handleMove(file)}
                  size="small"
                />
              </Tooltip>
            )}

            {DATA.allow_delete && (
              <Tooltip title="Delete">
                <Button
                  type="text"
                  danger
                  icon={<DeleteOutlined />}
                  onClick={() => handleDelete(file)}
                  size="small"
                />
              </Tooltip>
            )}
          </Space>
        );
      },
    },
  ];

  if (!paths || paths.length === 0) {
    return (
      <Empty
        image={<FolderOutlined style={{ fontSize: 64, color: '#d9d9d9' }} />}
        description={
          <div>
            <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 8 }}>
              This folder is empty
            </div>
            <div style={{ fontSize: 14, color: '#8c8c8c' }}>
              Upload files or create a new folder to get started
            </div>
          </div>
        }
        style={{ margin: '40px 0' }}
      />
    );
  }

  return (
    <div style={{ padding: '0 24px' }}>
      <Table
        columns={columns}
        dataSource={paths}
        rowKey="name"
        pagination={false}
        style={{ background: '#fff' }}
      />
    </div>
  );
}
