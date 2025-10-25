import { useState, useEffect } from "react";
import {
  Table,
  Button,
  Space,
  Tooltip,
  Modal,
  Input,
  message,
  Card,
  Row,
  Col,
  Dropdown,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import type { MenuProps } from "antd";
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
  MoreOutlined,
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

  // Mobile detection state
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);

  // Helper function to get just the filename without path
  const getBasename = (name: string) => {
    if (name.includes("/")) {
      return name.substring(name.lastIndexOf("/") + 1);
    }
    return name;
  };

  const [previewFile, setPreviewFile] = useState<string | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [draggedFile, setDraggedFile] = useState<PathItem | null>(null);
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);
  const [shareModalVisible, setShareModalVisible] = useState(false);
  const [shareUrl, setShareUrl] = useState("");
  const [sharingFile, setSharingFile] = useState<PathItem | null>(null);
  const [loadingShare, setLoadingShare] = useState(false);

  // Handle window resize for mobile detection
  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

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
    const displayName = getBasename(file.name);
    Modal.confirm({
      title: "Delete file",
      content: `Are you sure you want to delete "${displayName}"?`,
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
            content: `Cannot delete "${displayName}": ${error.message}`,
          });
        }
      },
    });
  };

  const handleMove = async (file: PathItem, newPath?: string | null) => {
    // Extract just the filename, not the full relative path
    // Use the last part of the path (filename only), or the full name if no slashes
    const fileName = file.name.includes("/")
      ? file.name.substring(file.name.lastIndexOf("/") + 1)
      : file.name;
    const currentFilePath =
      location.pathname +
      (location.pathname.endsWith("/") ? "" : "/") +
      fileName;

    const performMove = async (targetPath: string) => {
      if (!targetPath) return;
      if (!targetPath.startsWith("/")) targetPath = "/" + targetPath;
      if (currentFilePath === targetPath) return;

      // Extract the relative path from the absolute newPath
      // newPath is like "/Photos/Screenshot.png", need to convert to properly encoded path
      const pathSegments = targetPath.split("/").filter(Boolean);
      const fileName = pathSegments.pop() ?? ""; // Get the filename
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
                await moveFile({ fileName, destinationUrl });
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

        await moveFile({ fileName, destinationUrl });
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
    dragImage.textContent = `Moving: ${getBasename(file.name)}`;
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

    let newPath: string;

    // Handle ".." parent directory specially
    if (targetFolder.name === "..") {
      // Navigate to parent directory
      const pathParts = currentPath.split("/").filter(Boolean);
      pathParts.pop(); // Remove current directory
      newPath = "/" + pathParts.join("/") + "/" + draggedFile.name;
    } else {
      newPath = currentPath + targetFolder.name + "/" + draggedFile.name;
    }

    try {
      await handleMove(draggedFile, newPath);
    } catch (err) {
      console.error("Drop failed:", err);
    }
  };

  // Get actions menu for mobile view
  const getActionsMenu = (file: PathItem): MenuProps["items"] => {
    const isDir = file.path_type.endsWith("Dir");
    const path = filePath(file.name) + (isDir ? "/" : "");

    const items: MenuProps["items"] = [
      {
        key: "download",
        icon: <DownloadOutlined />,
        label: (
          <a
            href={
              path + (isDir && permissions.allow_archive ? "?zip" : "?download")
            }
            download
          >
            {isDir ? "Download as zip" : "Download"}
          </a>
        ),
      },
    ];

    if (!isDir) {
      items.push({
        key: "share",
        icon: <ShareAltOutlined />,
        label: "Share",
        onClick: () => handleShare(file),
      });
    }

    if (permissions.allow_upload && permissions.allow_delete) {
      items.push({
        key: "move",
        icon: <DragOutlined />,
        label: "Move",
        onClick: () => handleMove(file),
      });
    }

    if (permissions.allow_delete) {
      items.push({
        key: "delete",
        icon: <DeleteOutlined />,
        label: "Delete",
        danger: true,
        onClick: () => handleDelete(file),
      });
    }

    return items;
  };

  // Render grid view
  const renderGridView = () => (
    <div className="px-4 pb-4">
      <Row gutter={[16, 16]}>
        {paths.map((file) => {
          const isDir = file.path_type.endsWith("Dir");
          const path = filePath(file.name) + (isDir ? "/" : "");

          return (
            <Col key={file.name} xs={12} sm={8} md={6} lg={4} xl={3}>
              <Card
                hoverable
                className="h-full flex flex-col relative"
                styles={{ body: { padding: "12px" } }}
                onClick={() => {
                  if (!isDir) {
                    handleFileClick(file);
                  }
                }}
              >
                {/* Actions menu - positioned absolutely in top right */}
                <div
                  className="absolute top-2 right-2 z-10"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Dropdown
                    menu={{ items: getActionsMenu(file) }}
                    trigger={["click"]}
                  >
                    <Button
                      type="text"
                      icon={<MoreOutlined />}
                      size="small"
                      className="bg-white shadow-sm hover:bg-gray-50"
                    />
                  </Dropdown>
                </div>

                {/* Card content */}
                <div className="flex flex-col items-center text-center">
                  {/* Icon */}
                  <div className="text-5xl mb-2">
                    {isDir ? (
                      <Link to={path} onClick={(e) => e.stopPropagation()}>
                        {getFileIcon(file)}
                      </Link>
                    ) : (
                      getFileIcon(file)
                    )}
                  </div>

                  {/* File name */}
                  <div className="w-full wrap-break-words overflow-hidden">
                    {isDir ? (
                      <Link
                        to={path}
                        onClick={(e) => e.stopPropagation()}
                        className="text-sm font-medium text-blue-500 hover:text-blue-700 wrap-break-words"
                      >
                        {getBasename(file.name)}
                      </Link>
                    ) : (
                      <div className="text-sm font-medium text-gray-900 wrap-break-words">
                        {getBasename(file.name)}
                      </div>
                    )}
                  </div>

                  {/* Metadata */}
                  <div className="w-full mt-2 text-xs text-gray-500 wrap-break-words">
                    <div className="wrap-break-words">
                      {isDir
                        ? formatDirSize(file.size)
                        : formatFileSize(file.size).join(" ")}
                    </div>
                    <div className="wrap-break-words">
                      {formatMtime(file.mtime)}
                    </div>
                  </div>

                  {/* Verification for files */}
                  {!isDir && (
                    <div
                      className="w-full mt-2"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {renderVerificationStamps(file)}
                    </div>
                  )}
                </div>
              </Card>
            </Col>
          );
        })}
      </Row>
    </div>
  );

  const columns: ColumnsType<PathItem> = [
    {
      title: "Name",
      dataIndex: "name",
      key: "name",
      ellipsis: true,
      render: (name: string, file: PathItem) => {
        const isDir = file.path_type.endsWith("Dir");
        const path = filePath(file.name) + (isDir ? "/" : "");
        const displayName = getBasename(name);

        return (
          <Space>
            {getFileIcon(file)}
            {isDir ? (
              <Link to={path} className="text-blue-500 font-medium">
                {displayName}
              </Link>
            ) : (
              <a
                onClick={(e) => {
                  e.preventDefault();
                  handleFileClick(file);
                }}
                className="text-blue-500 font-medium cursor-pointer"
              >
                {displayName}
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
      fixed: true,
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
      {/* Render based on screen size - Mobile: Grid, Desktop: Table */}
      {isMobile ? (
        renderGridView()
      ) : (
        <Table
          loading={isLoading}
          columns={columns}
          dataSource={paths}
          rowKey="name"
          tableLayout="fixed"
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
      )}

      <FilePreviewDrawer
        open={isDrawerOpen}
        fileName={previewFile}
        onClose={handleDrawerClose}
        isMobile={isMobile}
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
