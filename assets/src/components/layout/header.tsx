import { useState } from "react";
import { Input, Button, Space, Layout, Drawer, Dropdown } from "antd";
import type { MenuProps } from "antd";
import {
  SearchOutlined,
  FolderAddOutlined,
  FileAddOutlined,
  DatabaseOutlined,
  MenuOutlined,
  MoreOutlined,
} from "@ant-design/icons";
import NodeLogo from "../vectors/node-logo.js";

const { Header: AntHeader } = Layout;

interface HeaderProps {
  onSearch?: (query: string) => void;
  onNewFolder?: () => void;
  onNewFile?: () => void;
}

export function Header({
  onSearch,
  onNewFolder,
  onNewFile,
}: HeaderProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [showMobileSearch, setShowMobileSearch] = useState(false);

  const handleSearch = () => {
    onSearch?.(searchQuery);
  };

  const handleDownloadDB = () => {
    const link = document.createElement("a");
    link.href = "/__dufs__/provenance-db";
    link.download = "provenance.db";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Mobile actions menu
  const mobileActionsMenu: MenuProps["items"] = [
    {
      key: "download-db",
      icon: <DatabaseOutlined />,
      label: "Download SQLite DB",
      onClick: handleDownloadDB,
    },
    {
      key: "new-folder",
      icon: <FolderAddOutlined />,
      label: "New Folder",
      onClick: onNewFolder,
    },
    {
      key: "new-file",
      icon: <FileAddOutlined />,
      label: "New File",
      onClick: onNewFile,
    },
  ];

  return (
    <>
      <AntHeader className="sticky top-0 z-50 w-full bg-white! border-b border-gray-200 px-4! flex items-center gap-2 md:gap-4 h-16">
        {/* Mobile: Hamburger menu */}
        <div className="md:hidden">
          <Button
            type="text"
            icon={<MenuOutlined />}
            onClick={() => setMobileDrawerOpen(true)}
            className="flex items-center justify-center"
          />
        </div>

        {/* Logo/Brand */}
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-blue-500">
            <NodeLogo />
          </div>
          <span className="font-semibold text-base hidden sm:inline">
            Node Drive
          </span>
        </div>

        {/* Desktop Search Bar */}
        <div className="hidden md:flex flex-1 max-w-[500px]">
          <Input
            placeholder="Search files and folders..."
            prefix={<SearchOutlined />}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onPressEnter={handleSearch}
            allowClear
          />
        </div>

        {/* Mobile Search Toggle */}
        <div className="md:hidden flex-1 flex justify-end">
          {showMobileSearch ? (
            <Input
              placeholder="Search..."
              prefix={<SearchOutlined />}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onPressEnter={handleSearch}
              onBlur={() => !searchQuery && setShowMobileSearch(false)}
              autoFocus
              allowClear
              className="w-full"
            />
          ) : (
            <Button
              type="text"
              icon={<SearchOutlined />}
              onClick={() => setShowMobileSearch(true)}
            />
          )}
        </div>

        {/* Desktop Actions */}
        <div className="hidden md:flex flex-1 justify-end">
          <Space>
            <Button
              type="dashed"
              icon={<DatabaseOutlined />}
              onClick={handleDownloadDB}
            >
              Download SQLite DB
            </Button>
            <Button icon={<FolderAddOutlined />} onClick={onNewFolder}>
              New Folder
            </Button>
            <Button icon={<FileAddOutlined />} onClick={onNewFile}>
              New File
            </Button>
          </Space>
        </div>

        {/* Mobile: Actions Menu */}
        <div className="md:hidden">
          <Dropdown menu={{ items: mobileActionsMenu }} trigger={["click"]}>
            <Button
              type="text"
              icon={<MoreOutlined />}
              className="flex items-center justify-center"
            />
          </Dropdown>
        </div>
      </AntHeader>

      {/* Mobile Drawer */}
      <Drawer
        title="Menu"
        placement="left"
        onClose={() => setMobileDrawerOpen(false)}
        open={mobileDrawerOpen}
        width={280}
      >
        <Space direction="vertical" className="w-full" size="large">
          {/* Actions */}
          <Space direction="vertical" className="w-full">
            <Button
              block
              icon={<DatabaseOutlined />}
              onClick={() => {
                handleDownloadDB();
                setMobileDrawerOpen(false);
              }}
            >
              Download SQLite DB
            </Button>
            <Button
              block
              icon={<FolderAddOutlined />}
              onClick={() => {
                onNewFolder?.();
                setMobileDrawerOpen(false);
              }}
            >
              New Folder
            </Button>
            <Button
              block
              icon={<FileAddOutlined />}
              onClick={() => {
                onNewFile?.();
                setMobileDrawerOpen(false);
              }}
            >
              New File
            </Button>
          </Space>
        </Space>
      </Drawer>
    </>
  );
}
