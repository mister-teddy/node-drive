import { useState } from 'react';
import { Input, Button, Space, Layout } from 'antd';
import {
  SearchOutlined,
  FolderAddOutlined,
  FileAddOutlined,
  UserOutlined,
  LogoutOutlined,
  LoginOutlined
} from '@ant-design/icons';

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
  const [searchQuery, setSearchQuery] = useState('');

  const handleSearch = () => {
    onSearch?.(searchQuery);
  };

  return (
    <AntHeader
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 50,
        width: '100%',
        background: '#fff',
        borderBottom: '1px solid #f0f0f0',
        padding: '0 24px',
        display: 'flex',
        alignItems: 'center',
        gap: '16px',
      }}
    >
      {/* Logo/Brand */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: '150px' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '32px',
            height: '32px',
            borderRadius: '8px',
            background: '#1890ff',
          }}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            style={{ width: '20px', height: '20px', color: '#fff' }}
          >
            <path
              d="M3 8L12 3L21 8M3 16L12 11L21 16M12 11V21"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <span style={{ fontWeight: 600, fontSize: '16px' }}>Node Drive</span>
      </div>

      {/* Search Bar */}
      {allowSearch && (
        <div style={{ flex: 1, maxWidth: '500px' }}>
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

      <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end' }}>
        <Space>
          {/* Action Buttons */}
          {allowUpload && (
            <>
              <Button
                icon={<FolderAddOutlined />}
                onClick={onNewFolder}
              >
                New Folder
              </Button>
              <Button
                icon={<FileAddOutlined />}
                onClick={onNewFile}
              >
                New File
              </Button>
            </>
          )}

          {/* User Menu */}
          {auth && user ? (
            <Button
              icon={<UserOutlined />}
              onClick={onLogout}
              type="text"
            >
              {user} <LogoutOutlined />
            </Button>
          ) : auth ? (
            <Button
              icon={<LoginOutlined />}
              onClick={onLogin}
              type="text"
            >
              Login
            </Button>
          ) : null}
        </Space>
      </div>
    </AntHeader>
  );
}
