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
  FileFilled,
  FileTextFilled,
  FileImageFilled,
  FileZipFilled,
  FileMarkdownFilled,
  FilePdfFilled,
  FileExcelFilled,
  FileWordFilled,
  FilePptFilled,
  DownloadOutlined,
  DeleteOutlined,
  DragOutlined,
  ShareAltOutlined,
  MoreOutlined,
  EditOutlined,
  FolderFilled,
} from "@ant-design/icons";
import { formatMtime, formatFileSize, formatDirSize, filePath } from "../utils";
import Provenance from "./provenance";
import { useNavigate } from "react-router-dom";
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
  getShareInfoAtom,
  deleteShareLinkAtom,
  type ShareInfoItem,
} from "../state/rest";

export interface PathItem {
  path_type: "Dir" | "SymlinkDir" | "File" | "SymlinkFile";
  name: string;
  mtime: number;
  size: number;
  sha256?: string;
  visibility?: "private" | "public";
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
  // Router navigation
  const navigate = useNavigate();

  // Use focused atoms for better performance
  const paths = useAtomValue(pathsAtom);
  const permissions = useAtomValue(permissionsAtom);
  const loadableData = useAtomValue(loadableDataAtom);

  // Mutation atoms
  const createShareLink = useSetAtom(createShareLinkAtom);
  const deleteFile = useSetAtom(deleteFileAtom);
  const moveFile = useSetAtom(moveFileAtom);
  const checkFileExists = useSetAtom(checkFileExistsAtom);
  const getShareInfo = useSetAtom(getShareInfoAtom);
  const deleteShareLink = useSetAtom(deleteShareLinkAtom);

  // Check if data is loading from any source
  const isLoading = loadableData.state === "loading";

  // Mobile detection state
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);

  // Detect if we're in search mode
  const searchParams = new URLSearchParams(location.search);
  const isSearchMode = searchParams.has("q");

  // Helper function to get just the filename without path
  const getBasename = (name: string) => {
    if (name.includes("/")) {
      return name.substring(name.lastIndexOf("/") + 1);
    }
    return name;
  };

  // Helper function to get display name (full path in search, basename otherwise)
  const getDisplayName = (name: string) => {
    return isSearchMode ? name : getBasename(name);
  };

  const [previewFile, setPreviewFile] = useState<string | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [draggedFile, setDraggedFile] = useState<PathItem | null>(null);
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);
  const [shareModalVisible, setShareModalVisible] = useState(false);
  const [shareUrl, setShareUrl] = useState("");
  const [sharingFile, setSharingFile] = useState<PathItem | null>(null);
  const [loadingShare, setLoadingShare] = useState(false);
  const [existingShares, setExistingShares] = useState<ShareInfoItem[]>([]);
  const [loadingShareInfo, setLoadingShareInfo] = useState(false);
  const [renameModalVisible, setRenameModalVisible] = useState(false);
  const [renamingFile, setRenamingFile] = useState<PathItem | null>(null);
  const [newFileName, setNewFileName] = useState("");

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
      return <FolderFilled style={{ color: "#3b82f6", fontSize: 24 }} />;
    }

    const ext = file.name.split(".").pop()?.toLowerCase() || "";

    // All file icons in gray for consistency
    const iconClass = "text-lg text-gray-400";

    // Images
    if (
      ["jpg", "jpeg", "png", "gif", "svg", "webp", "bmp", "ico"].includes(ext)
    ) {
      return <FileImageFilled className={iconClass} />;
    }
    // PDF
    if (ext === "pdf") {
      return <FilePdfFilled className={iconClass} />;
    }
    // Excel
    if (["xls", "xlsx", "csv"].includes(ext)) {
      return <FileExcelFilled className={iconClass} />;
    }
    // Word
    if (["doc", "docx"].includes(ext)) {
      return <FileWordFilled className={iconClass} />;
    }
    // PowerPoint
    if (["ppt", "pptx"].includes(ext)) {
      return <FilePptFilled className={iconClass} />;
    }
    // Archives
    if (["zip", "rar", "7z", "tar", "gz", "bz2"].includes(ext)) {
      return <FileZipFilled className={iconClass} />;
    }
    // Markdown
    if (["md", "markdown"].includes(ext)) {
      return <FileMarkdownFilled className={iconClass} />;
    }
    // Text/Code
    if (
      [
        "txt",
        "json",
        "xml",
        "yaml",
        "yml",
        "log",
        "ini",
        "cfg",
        "conf",
      ].includes(ext)
    ) {
      return <FileTextFilled className={iconClass} />;
    }

    return <FileFilled className={iconClass} />;
  };

  const renderVerificationStamps = (file: PathItem) => {
    return (
      <Provenance
        file={{
          type: "uploaded",
          filePath: file.name,
        }}
        cachedResult={{
          status: file.stamp_status?.success ? "verified" : "pending",
          sha256_hex: file.stamp_status?.sha256_hex || "",
          verified_chain: "bitcoin",
          verified_timestamp:
            file.stamp_status?.results?.bitcoin.timestamp || 0,
          verified_height: file.stamp_status?.results?.bitcoin.height || 0,
        }}
      />
    );
  };

  const handleShare = async (file: PathItem) => {
    setSharingFile(file);
    setLoadingShareInfo(true);
    setExistingShares([]);
    setShareUrl("");

    try {
      // First, check if there are existing shares
      const shareInfo = await getShareInfo(file.name);

      if (shareInfo.success && shareInfo.shares.length > 0) {
        // Existing share(s) found - show the first one
        const firstShare = shareInfo.shares[0];
        const fullShareUrl = window.location.origin + firstShare.share_url;
        setShareUrl(fullShareUrl);
        setExistingShares(shareInfo.shares);
        setShareModalVisible(true);
      } else {
        // No existing shares - create a new one
        setLoadingShare(true);
        const data = await createShareLink(file.name);

        if (data.success && data.share_url) {
          // Create full URL with current origin
          const fullShareUrl = window.location.origin + data.share_url;
          setShareUrl(fullShareUrl);
          setExistingShares([]);
          setShareModalVisible(true);
          message.success("Share link created successfully!");
        } else {
          throw new Error("Failed to create share link");
        }
        setLoadingShare(false);
      }
    } catch (err) {
      const error = err as Error;
      message.error(`Cannot create share link: ${error.message}`);
      setLoadingShare(false);
    } finally {
      setLoadingShareInfo(false);
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

  const handleDeleteShareLink = async (shareId: string) => {
    Modal.confirm({
      title: "Remove share link",
      content:
        "Are you sure you want to remove this share link? People with this link will no longer be able to access the file.",
      okText: "Remove",
      okType: "danger",
      cancelText: "Cancel",
      onOk: async () => {
        try {
          await deleteShareLink(shareId);
          message.success("Share link removed successfully");
          setShareModalVisible(false);
          setShareUrl("");
          setExistingShares([]);
        } catch (err) {
          const error = err as Error;
          message.error(`Failed to remove share link: ${error.message}`);
        }
      },
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

  const handleRename = (file: PathItem) => {
    const currentName = getBasename(file.name);
    setRenamingFile(file);
    setNewFileName(currentName);
    setRenameModalVisible(true);
  };

  const performRename = async () => {
    if (!renamingFile || !newFileName.trim()) return;

    const currentName = getBasename(renamingFile.name);

    // If name hasn't changed, just close modal
    if (currentName === newFileName.trim()) {
      setRenameModalVisible(false);
      return;
    }

    try {
      // Build the current file path (absolute)
      let currentFilePath: string;
      if (renamingFile.name.includes("/")) {
        // Search results: file.name is like "PDFs/file.pdf"
        currentFilePath = "/" + renamingFile.name;
      } else {
        // Normal directory view: file.name is just "file.pdf"
        currentFilePath =
          location.pathname +
          (location.pathname.endsWith("/") ? "" : "/") +
          renamingFile.name;
      }

      // Get the directory path from the current file path
      const lastSlashIndex = currentFilePath.lastIndexOf("/");
      const currentDir = currentFilePath.substring(0, lastSlashIndex + 1);

      // Build the new path (same directory, new filename)
      const newPath = currentDir + newFileName.trim();

      // Build the destination URL (without /api prefix)
      const destinationUrl = window.location.origin + newPath;

      // Use moveFile atom to rename (renaming is moving to new name in same dir)
      await moveFile({
        fileName: currentFilePath,
        destinationUrl: destinationUrl,
      });

      message.success(`Renamed to "${newFileName.trim()}"`);
      setRenameModalVisible(false);
      setRenamingFile(null);
      setNewFileName("");
    } catch (err) {
      const error = err as Error;
      Modal.error({
        title: "Rename failed",
        content: `Cannot rename "${currentName}": ${error.message}`,
      });
    }
  };

  const handleMove = async (file: PathItem, newPath?: string | null) => {
    // Build the current file path
    // If file.name contains slashes (like in search results: "PDFs/file.pdf"),
    // it's a path relative to root, so we prepend "/"
    // Otherwise, it's relative to current location
    let currentFilePath: string;
    if (file.name.includes("/")) {
      // Search results: file.name is like "PDFs/file.pdf"
      currentFilePath = "/" + file.name;
    } else {
      // Normal directory view: file.name is just "file.pdf"
      currentFilePath =
        location.pathname +
        (location.pathname.endsWith("/") ? "" : "/") +
        file.name;
    }

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
                await moveFile({ fileName: currentFilePath, destinationUrl });
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

        await moveFile({ fileName: currentFilePath, destinationUrl });
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

    // Get just the basename of the dragged file (not full path)
    const draggedFileName = getBasename(draggedFile.name);
    // Get just the basename of the target folder (not full path)
    const targetFolderName = getBasename(targetFolder.name);

    let newPath: string;

    // Handle ".." parent directory specially
    if (targetFolder.name === "..") {
      // Navigate to parent directory
      const pathParts = currentPath.split("/").filter(Boolean);
      pathParts.pop(); // Remove current directory
      newPath = "/" + pathParts.join("/") + "/" + draggedFileName;
    } else {
      newPath = currentPath + targetFolderName + "/" + draggedFileName;
    }

    try {
      await handleMove(draggedFile, newPath);
    } catch (err) {
      console.error("Drop failed:", err);
    }
  };

  // Get actions menu for desktop (includes Download as first item)
  const getActionsMenu = (file: PathItem): MenuProps["items"] => {
    const isDir = file.path_type.endsWith("Dir");
    const path = filePath(file.name) + (isDir ? "/" : "");
    const items: MenuProps["items"] = [];

    // Download (first item)
    items.push({
      key: "download",
      icon: <DownloadOutlined />,
      label: (
        <a
          href={
            path + (isDir && permissions.allow_archive ? "?zip" : "?download")
          }
          download
          onClick={(e) => e.stopPropagation()}
        >
          {isDir ? "Download as zip" : "Download"}
        </a>
      ),
    });

    if (permissions.allow_upload && permissions.allow_delete) {
      items.push({
        key: "rename",
        icon: <EditOutlined />,
        label: "Rename",
        onClick: () => {
          handleRename(file);
        },
      });
      items.push({
        key: "move",
        icon: <DragOutlined />,
        label: "Move",
        onClick: () => {
          handleMove(file);
        },
      });
    }

    if (permissions.allow_delete) {
      items.push({
        key: "delete",
        icon: <DeleteOutlined />,
        label: "Delete",
        danger: true,
        onClick: () => {
          handleDelete(file);
        },
      });
    }

    return items;
  };

  // Get complete actions menu for mobile (includes all actions)
  const getMobileActionsMenu = (file: PathItem): MenuProps["items"] => {
    const isDir = file.path_type.endsWith("Dir");
    const path = filePath(file.name) + (isDir ? "/" : "");
    const items: MenuProps["items"] = [];

    // Download
    items.push({
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
    });

    // Share (files only)
    if (!isDir) {
      items.push({
        key: "share",
        icon: <ShareAltOutlined />,
        label: "Share",
        onClick: () => handleShare(file),
      });
    }

    // Rename and Move
    if (permissions.allow_upload && permissions.allow_delete) {
      items.push({
        key: "rename",
        icon: <EditOutlined />,
        label: "Rename",
        onClick: () => handleRename(file),
      });
      items.push({
        key: "move",
        icon: <DragOutlined />,
        label: "Move",
        onClick: () => handleMove(file),
      });
    }

    // Delete
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
                  if (isDir) {
                    navigate(path);
                  } else {
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
                    menu={{ items: getMobileActionsMenu(file) }}
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
                  <div className="text-5xl mb-2">{getFileIcon(file)}</div>

                  {/* File name */}
                  <div className="w-full wrap-break-words overflow-hidden">
                    <div className="text-sm font-medium text-gray-900 wrap-break-words">
                      {getDisplayName(file.name)}
                    </div>
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

  // Sort paths: directories first, then public files, then private files
  const sortedPaths = [...paths].sort((a, b) => {
    const aIsDir = a.path_type.endsWith("Dir");
    const bIsDir = b.path_type.endsWith("Dir");
    const aIsPublic = a.visibility === "public";
    const bIsPublic = b.visibility === "public";

    // Directories always first
    if (aIsDir && !bIsDir) return -1;
    if (!aIsDir && bIsDir) return 1;

    // Among files: public before private
    if (!aIsDir && !bIsDir) {
      if (aIsPublic && !bIsPublic) return -1;
      if (!aIsPublic && bIsPublic) return 1;
    }

    return 0;
  });

  const columns: ColumnsType<PathItem> = [
    {
      title: "Name",
      dataIndex: "name",
      key: "name",
      ellipsis: true,
      render: (name: string, file: PathItem) => {
        const displayName = getDisplayName(name);

        return (
          <Space>
            <div className="w-6 h-6 flex justify-center items-center">
              {getFileIcon(file)}
            </div>
            <span className="text-gray-900">{displayName}</span>
          </Space>
        );
      },
      onCell: (record: PathItem) => {
        const isFolder = record.path_type.endsWith("Dir");
        const path = filePath(record.name) + (isFolder ? "/" : "");

        return {
          onClick: () => {
            if (isFolder) {
              navigate(path);
            } else {
              handleFileClick(record);
            }
          },
          className: "cursor-pointer",
        };
      },
    },
    {
      title: "Verification",
      key: "verification",
      width: 150,
      align: "center",
      render: (_: unknown, file: PathItem) => {
        const isDir = file.path_type.endsWith("Dir");
        return !isDir ? renderVerificationStamps(file) : null;
      },
    },
    {
      title: "Who can access",
      key: "visibility",
      width: 160,
      align: "center",
      render: (_: unknown, file: PathItem) => {
        const isDir = file.path_type.endsWith("Dir");
        if (isDir) return null;

        const visibility = file.visibility || "private";
        return (
          <span
            className={
              visibility === "public" ? "text-green-600" : "text-gray-500"
            }
          >
            {visibility === "public" ? "Anyone with the link" : "Only you"}
          </span>
        );
      },
    },
    {
      title: "Size",
      key: "size",
      width: 120,
      align: "right",
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
      align: "right",
      render: (mtime: number) => (
        <span className="text-gray-500">{formatMtime(mtime)}</span>
      ),
    },
    {
      title: "Actions",
      key: "actions",
      width: 120,
      align: "right",
      fixed: true,
      render: (_: unknown, file: PathItem) => {
        const isDir = file.path_type.endsWith("Dir");

        // Build actions menu items
        const menuItems = getActionsMenu(file);

        return (
          <Space size="small" align="end">
            {/* Only Share button visible (files only) */}
            {!isDir && (
              <Tooltip title="Share">
                <Button
                  type="text"
                  icon={<ShareAltOutlined />}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleShare(file);
                  }}
                  loading={
                    (loadingShare || loadingShareInfo) &&
                    sharingFile?.name === file.name
                  }
                  size="small"
                />
              </Tooltip>
            )}

            {/* More actions menu (always visible, includes Download) */}
            {menuItems && menuItems.length > 0 && (
              <Dropdown menu={{ items: menuItems }} trigger={["click"]}>
                <Button
                  type="text"
                  icon={<MoreOutlined />}
                  onClick={(e) => e.stopPropagation()}
                  size="small"
                  className="hover:bg-gray-100"
                />
              </Dropdown>
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
          dataSource={sortedPaths}
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
                isDragging ? "opacity-50" : ""
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
        onCancel={() => {
          setShareModalVisible(false);
          setShareUrl("");
          setExistingShares([]);
        }}
        footer={[
          existingShares.length > 0 && (
            <Button
              key="remove"
              danger
              onClick={() => handleDeleteShareLink(existingShares[0].share_id)}
            >
              Remove Link
            </Button>
          ),
          <Button key="copy" type="primary" onClick={handleCopyShareLink}>
            Copy Link
          </Button>,
          <Button
            key="close"
            onClick={() => {
              setShareModalVisible(false);
              setShareUrl("");
              setExistingShares([]);
            }}
          >
            Close
          </Button>,
        ]}
      >
        <div className="mb-4">
          {existingShares.length > 0 ? (
            <>
              <p className="mb-2 text-gray-700 font-medium">
                This file is already shared
              </p>
              <p className="mb-2 text-gray-500 text-sm">
                Anyone with this link can download the file:
              </p>
            </>
          ) : (
            <p className="mb-2 text-gray-500">
              Share this link to allow others to download the file:
            </p>
          )}
          <Input
            value={shareUrl}
            readOnly
            onClick={(e) => e.currentTarget.select()}
            className="font-mono text-xs"
          />
        </div>

        {/* Share statistics for existing shares */}
        {existingShares.length > 0 && existingShares[0] && (
          <div className="mb-4 p-3 bg-blue-50 rounded border border-blue-200">
            <p className="m-0 text-sm text-gray-700">
              <strong>Created:</strong>{" "}
              {new Date(existingShares[0].created_at).toLocaleString()}
            </p>
            <p className="mt-1 mb-0 text-sm text-gray-700">
              <strong>Downloads:</strong> {existingShares[0].downloads}
            </p>
          </div>
        )}

        {sharingFile && (
          <div className="mt-4 p-3 bg-gray-100 rounded">
            <p className="m-0 text-xs text-gray-600">
              <strong>File:</strong> {getBasename(sharingFile.name)}
            </p>
            <p className="mt-1 mb-0 text-xs text-gray-600">
              <strong>Note:</strong> Anyone with this link can download the
              file. The download will be tracked with cryptographic
              verification.
            </p>
          </div>
        )}
      </Modal>

      {/* Rename Modal */}
      <Modal
        title="Rename"
        open={renameModalVisible}
        onCancel={() => {
          setRenameModalVisible(false);
          setRenamingFile(null);
          setNewFileName("");
        }}
        onOk={performRename}
        okText="Rename"
        cancelText="Cancel"
      >
        <div className="mb-4">
          <p className="mb-2 text-gray-500">
            Enter the new name for{" "}
            <strong>{renamingFile && getBasename(renamingFile.name)}</strong>:
          </p>
          <Input
            value={newFileName}
            onChange={(e) => setNewFileName(e.target.value)}
            onPressEnter={performRename}
            placeholder="New file name"
            autoFocus
          />
        </div>
      </Modal>
    </>
  );
}
