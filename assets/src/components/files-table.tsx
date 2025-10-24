import { useState } from "react";
import { Table, Button, Space, Tooltip, Modal, Input, message } from "antd";
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
  ShareAltOutlined,
} from "@ant-design/icons";
import { formatMtime, formatFileSize, formatDirSize, filePath } from "../utils";
import Provenance from "./provenance";
import { Link } from "react-router-dom";
import FilePreviewDrawer from "./file-preview-drawer";
import { useAtomValue, useSetAtom } from "jotai";
import {
  pathsAtom,
  permissionsAtom,
  loadableDataAtom,
  createShareLinkAtom,
  deleteFileAtom,
  moveFileAtom,
  checkFileExistsAtom,
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

interface FilesTableProps {}

export default function FilesTable({}: FilesTableProps) {
  // Use focused atoms for better performance
  const paths = useAtomValue(pathsAtom);
  const permissions = useAtomValue(permissionsAtom);
  const loadableData = useAtomValue(loadableDataAtom);

  // Mutation atoms
  const createShareLink = useSetAtom(createShareLinkAtom);
  const deleteFile = useSetAtom(deleteFileAtom);
  const moveFile = useSetAtom(moveFileAtom);
  const checkFileExists = useSetAtom(checkFileExistsAtom);

  // Check if data is loading from any source
  const isLoading = loadableData.state === "loading";

  const [previewFile, setPreviewFile] = useState<string | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [draggedFile, setDraggedFile] = useState<PathItem | null>(null);
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);
  const [shareModalVisible, setShareModalVisible] = useState(false);
  const [shareUrl, setShareUrl] = useState("");
  const [sharingFile, setSharingFile] = useState<PathItem | null>(null);
  const [loadingShare, setLoadingShare] = useState(false);

  const getFileIcon = (file: PathItem) => {
    const isDir = file.path_type.endsWith("Dir");
    if (isDir) {
      return <FolderOutlined className="text-lg text-blue-500" />;
    }

    const ext = file.name.split(".").pop()?.toLowerCase() || "";

    // Images
    if (["jpg", "jpeg", "png", "gif", "svg", "webp", "bmp"].includes(ext)) {
      return <FileImageOutlined className="text-lg text-green-500" />;
    }
    // Archives
    if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) {
      return <FileZipOutlined className="text-lg text-orange-500" />;
    }
    // Markdown
    if (["md", "markdown"].includes(ext)) {
      return <FileMarkdownOutlined className="text-lg text-purple-600" />;
    }
    // Text
    if (["txt", "json", "xml", "yaml", "yml"].includes(ext)) {
      return <FileTextOutlined className="text-lg text-gray-500" />;
    }

    return <FileOutlined className="text-lg text-gray-300" />;
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

  const handleShare = async (file: PathItem) => {
    setSharingFile(file);
    setLoadingShare(true);

    try {
      const data = await createShareLink(file.name);

      if (data.success && data.share_url) {
        // Create full URL with current origin
        const fullShareUrl = window.location.origin + data.share_url;
        setShareUrl(fullShareUrl);
        setShareModalVisible(true);
        message.success("Share link created successfully!");
      } else {
        throw new Error("Failed to create share link");
      }
    } catch (err) {
      const error = err as Error;
      message.error(`Cannot create share link: ${error.message}`);
    } finally {
      setLoadingShare(false);
    }
  };

  const handleCopyShareLink = () => {
    navigator.clipboard
      .writeText(shareUrl)
      .then(() => {
        message.success("Share link copied to clipboard!");
      })
      .catch(() => {
        message.error("Failed to copy link");
      });
  };

  const handleDelete = async (file: PathItem) => {
    Modal.confirm({
      title: "Delete file",
      content: `Are you sure you want to delete "${file.name}"?`,
      okText: "Delete",
      okType: "danger",
      cancelText: "Cancel",
      onOk: async () => {
        try {
          await deleteFile(file.name);
          // No need to manually refresh - the atom does it
        } catch (err) {
          const error = err as Error;
          Modal.error({
            title: "Delete failed",
            content: `Cannot delete "${file.name}": ${error.message}`,
          });
        }
      },
    });
  };

  const handleMove = async (file: PathItem, newPath?: string | null) => {
    const currentFilePath =
      location.pathname +
      (location.pathname.endsWith("/") ? "" : "/") +
      file.name;

    const performMove = async (targetPath: string) => {
      if (!targetPath) return;
      if (!targetPath.startsWith("/")) targetPath = "/" + targetPath;
      if (currentFilePath === targetPath) return;

      // Extract the relative path from the absolute newPath
      // newPath is like "/Photos/Screenshot.png", need to convert to properly encoded path
      const pathSegments = targetPath.split("/").filter(Boolean);
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
        const fileExists = await checkFileExists(apiNewFileUrl);

        if (fileExists) {
          Modal.confirm({
            title: "File exists",
            content:
              "A file already exists at this location. Do you want to override it?",
            okText: "Override",
            okType: "danger",
            cancelText: "Cancel",
            onOk: async () => {
              try {
                await moveFile({ fileName: file.name, destinationUrl });
                // No need to manually refresh - the atom does it
              } catch (err) {
                const error = err as Error;
                Modal.error({
                  title: "Move failed",
                  content: `Cannot move "${currentFilePath}" to "${targetPath}": ${error.message}`,
                });
              }
            },
          });
          return;
        }

        await moveFile({ fileName: file.name, destinationUrl });
        // No need to manually refresh - the atom does it
      } catch (err) {
        const error = err as Error;
        Modal.error({
          title: "Move failed",
          content: `Cannot move "${currentFilePath}" to "${targetPath}": ${error.message}`,
        });
      }
    };

    if (!newPath) {
      let movePath = currentFilePath;
      Modal.confirm({
        title: "Move file",
        content: (
          <Input
            placeholder="Enter new path"
            defaultValue={currentFilePath}
            onChange={(e) => {
              movePath = e.target.value;
            }}
            onPressEnter={() => {
              Modal.destroyAll();
              performMove(movePath);
            }}
            autoFocus
          />
        ),
        okText: "Move",
        cancelText: "Cancel",
        onOk: () => {
          performMove(movePath);
        },
      });
    } else {
      performMove(newPath);
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
    dragImage.className =
      "absolute -top-[1000px] px-3 py-2 bg-blue-500 text-white rounded text-sm font-medium";
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
    // If we're not dragging an internal row, this must be an external file drag
    // Let it bubble up to Uppy's DropTarget on document.body
    if (!draggedFile) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    const isDir = targetFile.path_type.endsWith("Dir");

    // Only allow dropping on folders
    if (isDir && draggedFile.name !== targetFile.name) {
      e.dataTransfer.dropEffect = "move";
      setDragOverFolder(targetFile.name);
    } else {
      e.dataTransfer.dropEffect = "none";
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    // Only handle internal row drags
    if (!draggedFile) {
      return;
    }

    e.preventDefault();
    setDragOverFolder(null);
  };

  const handleDrop = async (e: React.DragEvent, targetFolder: PathItem) => {
    // If we're not dragging an internal row, this is an external file drag
    // Let it bubble up to Uppy's DropTarget
    if (!draggedFile) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    setDragOverFolder(null);

    const isDir = targetFolder.path_type.endsWith("Dir");

    if (!isDir || draggedFile.name === targetFolder.name) {
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
              <Link to={path} className="text-blue-500 font-medium">
                {name}
              </Link>
            ) : (
              <a
                onClick={(e) => {
                  e.preventDefault();
                  handleFileClick(file);
                }}
                className="text-blue-500 font-medium cursor-pointer"
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
        return <span className="text-gray-500">{sizeDisplay}</span>;
      },
    },
    {
      title: "Modified",
      dataIndex: "mtime",
      key: "mtime",
      width: 180,
      render: (mtime: number) => (
        <span className="text-gray-500">{formatMtime(mtime)}</span>
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
                href={
                  path +
                  (isDir && permissions.allow_archive ? "?zip" : "?download")
                }
                download
                size="small"
              />
            </Tooltip>

            {!isDir && (
              <Tooltip title="Share file">
                <Button
                  type="text"
                  icon={<ShareAltOutlined />}
                  onClick={() => handleShare(file)}
                  loading={loadingShare && sharingFile?.name === file.name}
                  size="small"
                />
              </Tooltip>
            )}

            {permissions.allow_upload && permissions.allow_delete && (
              <Tooltip title="Move to new path">
                <Button
                  type="text"
                  icon={<DragOutlined />}
                  onClick={() => handleMove(file)}
                  size="small"
                />
              </Tooltip>
            )}

            {permissions.allow_delete && (
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

  return (
    <>
      <Table
        loading={isLoading}
        columns={columns}
        dataSource={paths}
        rowKey="name"
        pagination={false}
        className="bg-white"
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
            className: `transition-all duration-200 ease-in-out ${
              isDragging ? "cursor-grabbing opacity-50" : "cursor-grab"
            } ${
              isDropTarget && isFolder
                ? "bg-blue-50 border-l-[3px] border-l-blue-500"
                : ""
            }`,
          };
        }}
      />

      <FilePreviewDrawer
        open={isDrawerOpen}
        fileName={previewFile}
        onClose={handleDrawerClose}
      />

      <Modal
        title="Share File"
        open={shareModalVisible}
        onCancel={() => setShareModalVisible(false)}
        footer={[
          <Button key="copy" type="primary" onClick={handleCopyShareLink}>
            Copy Link
          </Button>,
          <Button key="close" onClick={() => setShareModalVisible(false)}>
            Close
          </Button>,
        ]}
      >
        <div className="mb-4">
          <p className="mb-2 text-gray-500">
            Share this link to allow others to download the file:
          </p>
          <Input
            value={shareUrl}
            readOnly
            onClick={(e) => e.currentTarget.select()}
            className="font-mono text-xs"
          />
        </div>
        {sharingFile && (
          <div className="mt-4 p-3 bg-gray-100 rounded">
            <p className="m-0 text-xs text-gray-600">
              <strong>File:</strong> {sharingFile.name}
            </p>
            <p className="mt-1 mb-0 text-xs text-gray-600">
              <strong>Note:</strong> Anyone with this link can download the
              file. The download will be tracked with cryptographic
              verification.
            </p>
          </div>
        )}
      </Modal>
    </>
  );
}
