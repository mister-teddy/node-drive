import { useState } from "react";
import { Input, Button, Space, Layout } from "antd";
import {
  SearchOutlined,
  FolderAddOutlined,
  FileAddOutlined,
  UserOutlined,
  LogoutOutlined,
  LoginOutlined,
  DatabaseOutlined,
} from "@ant-design/icons";
import NodeLogo from "../vectors/node-logo.js";

const { Header: AntHeader } = Layout;

interface HeaderProps {
  auth: boolean;
  user: string;
  allowUpload: boolean;
  allowSearch: boolean;
  onSearch?: (query: string) => void;
  onLogin?: () => void;
  onLogout?: () => void;
  onNewFolder?: () => void;
  onNewFile?: () => void;
}

export function Header({
  auth,
  user,
  allowUpload,
  allowSearch,
  onSearch,
  onLogin,
  onLogout,
  onNewFolder,
  onNewFile,
}: HeaderProps) {
  const [searchQuery, setSearchQuery] = useState("");

  const handleSearch = () => {
    onSearch?.(searchQuery);
  };

  return (
    <AntHeader className="sticky top-0 z-50 w-full bg-white! border-b border-gray-200 px-6 flex items-center gap-4">
      {/* Logo/Brand */}
      <div className="flex items-center gap-2 min-w-[150px]">
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-blue-500">
          <NodeLogo />
        </div>
        <span className="font-semibold text-base">Node Drive</span>
      </div>

      {/* Search Bar */}
      {allowSearch && (
        <div className="flex-1 max-w-[500px]">
          <Input
            placeholder="Search files and folders..."
            prefix={<SearchOutlined />}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onPressEnter={handleSearch}
            allowClear
          />
        </div>
      )}

      <div className="flex-1 flex justify-end">
        <Space>
          {/* Action Buttons */}
          {allowUpload && (
            <>
              <Button
                type="dashed"
                icon={<DatabaseOutlined />}
                onClick={() => {
                  // Download the provenance database
                  const link = document.createElement("a");
                  link.href = "/__dufs__/provenance-db";
                  link.download = "provenance.db";
                  document.body.appendChild(link);
                  link.click();
                  document.body.removeChild(link);
                }}
              >
                Download SQLite DB
              </Button>
              <Button icon={<FolderAddOutlined />} onClick={onNewFolder}>
                New Folder
              </Button>
              <Button icon={<FileAddOutlined />} onClick={onNewFile}>
                New File
              </Button>
            </>
          )}

          {/* User Menu */}
          {auth && user ? (
            <Button icon={<UserOutlined />} onClick={onLogout} type="text">
              {user} <LogoutOutlined />
            </Button>
          ) : auth ? (
            <Button icon={<LoginOutlined />} onClick={onLogin} type="text">
              Login
            </Button>
          ) : null}
        </Space>
      </div>
    </AntHeader>
  );
}
