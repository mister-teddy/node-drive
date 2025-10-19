import { useState } from "react";
import { Table, Button, Space, Empty, Tooltip } from "antd";
import type { ColumnsType } from "antd/es/table";
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
} from "@ant-design/icons";
import {
  formatMtime,
  formatFileSize,
  formatDirSize,
  apiPath,
  filePath,
} from "../utils";
import Provenance from "./provenance";
import { Link } from "react-router-dom";
import FilePreviewDrawer from "./file-preview-drawer";
import { useAtomValue, useSetAtom } from "jotai";
import {
  dataAtom,
  pathsAtom,
  allowUploadAtom,
  allowDeleteAtom,
  allowArchiveAtom,
} from "../state";

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

interface FilesTableProps {
  loading?: boolean;
}

export default function FilesTable({ loading }: FilesTableProps) {
  const DATA = useAtomValue(dataAtom);
  const paths = useAtomValue(pathsAtom);
  const allowUpload = useAtomValue(allowUploadAtom);
  const allowDelete = useAtomValue(allowDeleteAtom);
  const allowArchive = useAtomValue(allowArchiveAtom);
  const refreshData = useSetAtom(dataAtom);

  console.log({ DATA, paths });
  const [previewFile, setPreviewFile] = useState<string | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [draggedFile, setDraggedFile] = useState<PathItem | null>(null);
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);

  const getFileIcon = (file: PathItem) => {
    const isDir = file.path_type.endsWith("Dir");
    if (isDir) {
      return <FolderOutlined style={{ fontSize: "18px", color: "#1890ff" }} />;
    }

    const ext = file.name.split(".").pop()?.toLowerCase() || "";

    // Images
    if (["jpg", "jpeg", "png", "gif", "svg", "webp", "bmp"].includes(ext)) {
      return (
        <FileImageOutlined style={{ fontSize: "18px", color: "#52c41a" }} />
      );
    }
    // Archives
    if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) {
      return <FileZipOutlined style={{ fontSize: "18px", color: "#fa8c16" }} />;
    }
    // Markdown
    if (["md", "markdown"].includes(ext)) {
      return (
        <FileMarkdownOutlined style={{ fontSize: "18px", color: "#722ed1" }} />
      );
    }
    // Text
    if (["txt", "json", "xml", "yaml", "yml"].includes(ext)) {
      return (
        <FileTextOutlined style={{ fontSize: "18px", color: "#8c8c8c" }} />
      );
    }

    return <FileOutlined style={{ fontSize: "18px", color: "#d9d9d9" }} />;
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
      const url = apiPath(file.name);
      const res = await fetch(url, {
        method: "DELETE",
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      // Refresh data from server to update the file list
      refreshData();
    } catch (err) {
      const error = err as Error;
      alert(`Cannot delete "${file.name}": ${error.message}`);
    }
  };

  const handleMove = async (file: PathItem, newPath?: string | null) => {
    const currentFilePath =
      location.pathname +
      (location.pathname.endsWith("/") ? "" : "/") +
      file.name;

    if (!newPath) {
      newPath = prompt("Enter new path", currentFilePath) || undefined;
    }

    if (!newPath) return;
    if (!newPath.startsWith("/")) newPath = "/" + newPath;
    if (currentFilePath === newPath) return;

    const apiFileUrl = apiPath(file.name);

    // Extract the relative path from the absolute newPath
    // newPath is like "/Photos/Screenshot.png", need to convert to properly encoded path
    const pathSegments = newPath.split("/").filter(Boolean);
    const fileName = pathSegments.pop(); // Get the filename
    const folderPath = "/" + pathSegments.join("/"); // Get the folder path

    // Build properly encoded destination path
    // Note: We encode the path but DON'T add /api prefix for the Destination header
    // The backend expects the destination path WITHOUT /api prefix
    let destinationPath = folderPath;
    if (!destinationPath.endsWith("/")) destinationPath += "/";
    destinationPath += fileName?.split("/").map(encodeURIComponent).join("/");

    // WebDAV requires full URL in Destination header (without /api prefix!)
    const destinationUrl = window.location.origin + destinationPath;

    // Build the API URL for checking if destination exists
    let apiNewFileUrl = "/api" + folderPath;
    if (!apiNewFileUrl.endsWith("/")) apiNewFileUrl += "/";
    apiNewFileUrl += fileName?.split("/").map(encodeURIComponent).join("/");

    try {
      const res1 = await fetch(apiNewFileUrl, {
        method: "HEAD",
      });
      if (res1.status === 200) {
        if (!confirm("Override existing file?")) {
          return;
        }
      }

      const res2 = await fetch(apiFileUrl, {
        method: "MOVE",
        headers: {
          Destination: destinationUrl,
        },
      });

      if (!res2.ok) {
        const errorText = await res2.text();
        throw new Error(`HTTP ${res2.status}: ${errorText || res2.statusText}`);
      }

      location.reload();
    } catch (err) {
      const error = err as Error;
      alert(
        `Cannot move "${currentFilePath}" to "${newPath}": ${error.message}`
      );
    }
  };

  const handleFileClick = (file: PathItem) => {
    setPreviewFile(file.name);
    setIsDrawerOpen(true);
  };

  const handleDrawerClose = () => {
    setIsDrawerOpen(false);
    setPreviewFile(null);
  };

  // Drag and drop handlers
  const handleDragStart = (e: React.DragEvent, file: PathItem) => {
    setDraggedFile(file);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", file.name);

    // Create a custom drag image with the file name
    const dragImage = document.createElement("div");
    dragImage.style.position = "absolute";
    dragImage.style.top = "-1000px";
    dragImage.style.padding = "8px 12px";
    dragImage.style.backgroundColor = "#1890ff";
    dragImage.style.color = "white";
    dragImage.style.borderRadius = "4px";
    dragImage.style.fontSize = "14px";
    dragImage.style.fontWeight = "500";
    dragImage.textContent = `Moving: ${file.name}`;
    document.body.appendChild(dragImage);
    e.dataTransfer.setDragImage(dragImage, 0, 0);
    setTimeout(() => document.body.removeChild(dragImage), 0);

    // Add visual feedback
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = "0.5";
    }
  };

  const handleDragEnd = (e: React.DragEvent) => {
    setDraggedFile(null);
    setDragOverFolder(null);

    // Remove visual feedback
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = "1";
    }
  };

  const handleDragOver = (e: React.DragEvent, targetFile: PathItem) => {
    e.preventDefault();
    e.stopPropagation();

    const isDir = targetFile.path_type.endsWith("Dir");

    // Only allow dropping on folders
    if (isDir && draggedFile && draggedFile.name !== targetFile.name) {
      e.dataTransfer.dropEffect = "move";
      setDragOverFolder(targetFile.name);
    } else {
      e.dataTransfer.dropEffect = "none";
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOverFolder(null);
  };

  const handleDrop = async (e: React.DragEvent, targetFolder: PathItem) => {
    e.preventDefault();
    e.stopPropagation();

    setDragOverFolder(null);

    const isDir = targetFolder.path_type.endsWith("Dir");

    if (!draggedFile || !isDir || draggedFile.name === targetFolder.name) {
      return;
    }

    // Build the new path
    const currentPath = location.pathname.endsWith("/")
      ? location.pathname
      : location.pathname + "/";
    const newPath = currentPath + targetFolder.name + "/" + draggedFile.name;

    try {
      await handleMove(draggedFile, newPath);
    } catch (err) {
      console.error("Drop failed:", err);
    }
  };

  const columns: ColumnsType<PathItem> = [
    {
      title: "Name",
      dataIndex: "name",
      key: "name",
      render: (name: string, file: PathItem) => {
        const isDir = file.path_type.endsWith("Dir");
        const path = filePath(file.name) + (isDir ? "/" : "");

        return (
          <Space>
            {getFileIcon(file)}
            {isDir ? (
              <Link to={path} style={{ color: "#1890ff", fontWeight: 500 }}>
                {name}
              </Link>
            ) : (
              <a
                onClick={(e) => {
                  e.preventDefault();
                  handleFileClick(file);
                }}
                style={{ color: "#1890ff", fontWeight: 500, cursor: "pointer" }}
              >
                {name}
              </a>
            )}
          </Space>
        );
      },
    },
    {
      title: "Verification",
      key: "verification",
      width: 150,
      render: (_: unknown, file: PathItem) => {
        const isDir = file.path_type.endsWith("Dir");
        return !isDir ? renderVerificationStamps(file) : null;
      },
    },
    {
      title: "Size",
      key: "size",
      width: 120,
      render: (_: unknown, file: PathItem) => {
        const isDir = file.path_type.endsWith("Dir");
        const sizeDisplay = isDir
          ? formatDirSize(file.size)
          : formatFileSize(file.size).join(" ");
        return <span style={{ color: "#8c8c8c" }}>{sizeDisplay}</span>;
      },
    },
    {
      title: "Modified",
      dataIndex: "mtime",
      key: "mtime",
      width: 180,
      render: (mtime: number) => (
        <span style={{ color: "#8c8c8c" }}>{formatMtime(mtime)}</span>
      ),
    },
    {
      title: "Actions",
      key: "actions",
      width: 150,
      render: (_: unknown, file: PathItem) => {
        const isDir = file.path_type.endsWith("Dir");
        const path = filePath(file.name) + (isDir ? "/" : "");

        return (
          <Space>
            <Tooltip title={isDir ? "Download folder as zip" : "Download file"}>
              <Button
                type="text"
                icon={<DownloadOutlined />}
                href={path + (isDir && allowArchive ? "?zip" : "")}
                download
                size="small"
              />
            </Tooltip>

            {allowUpload && allowDelete && (
              <Tooltip title="Move to new path">
                <Button
                  type="text"
                  icon={<DragOutlined />}
                  onClick={() => handleMove(file)}
                  size="small"
                />
              </Tooltip>
            )}

            {allowDelete && (
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
        image={<FolderOutlined style={{ fontSize: 64, color: "#d9d9d9" }} />}
        description={
          <div>
            <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 8 }}>
              This folder is empty
            </div>
            <div style={{ fontSize: 14, color: "#8c8c8c" }}>
              Upload files or create a new folder to get started
            </div>
          </div>
        }
        style={{ margin: "40px 0" }}
      />
    );
  }

  return (
    <>
      <div style={{ padding: "0 24px 24px" }}>
        <Table
          loading={loading}
          columns={columns}
          dataSource={paths}
          rowKey="name"
          pagination={false}
          style={{ background: "#fff" }}
          onRow={(record: PathItem) => {
            const isFolder = record.path_type.endsWith("Dir");
            const isDragging = draggedFile?.name === record.name;
            const isDropTarget = dragOverFolder === record.name;

            return {
              draggable: true,
              onDragStart: (e) => handleDragStart(e, record),
              onDragEnd: handleDragEnd,
              onDragOver: (e) => handleDragOver(e, record),
              onDragLeave: handleDragLeave,
              onDrop: (e) => handleDrop(e, record),
              style: {
                cursor: isDragging ? "grabbing" : "grab",
                opacity: isDragging ? 0.5 : 1,
                backgroundColor:
                  isDropTarget && isFolder ? "#e6f7ff" : undefined,
                borderLeft:
                  isDropTarget && isFolder ? "3px solid #1890ff" : undefined,
                transition: "all 0.2s ease",
              },
            };
          }}
        />
      </div>

      <FilePreviewDrawer
        open={isDrawerOpen}
        fileName={previewFile}
        onClose={handleDrawerClose}
      />
    </>
  );
}
