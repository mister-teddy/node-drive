import React, { useState } from 'react';
import { Search, FolderPlus, FilePlus, User, LogOut, LogIn } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';

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

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    onSearch?.(searchQuery);
  };

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-16 items-center gap-4 px-6">
        {/* Logo/Brand */}
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              className="h-5 w-5 text-primary-foreground"
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
          <span className="hidden font-semibold sm:inline-block">
            Node Drive
          </span>
        </div>

        {/* Search Bar */}
        {allowSearch && (
          <form onSubmit={handleSearch} className="flex-1 max-w-md">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Search files and folders..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
          </form>
        )}

        <div className="flex flex-1 items-center justify-end gap-2">
          {/* Action Buttons */}
          {allowUpload && (
            <div className="hidden items-center gap-2 md:flex">
              <Button
                variant="outline"
                size="sm"
                onClick={onNewFolder}
                className="gap-2"
              >
                <FolderPlus className="h-4 w-4" />
                <span className="hidden lg:inline">New Folder</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={onNewFile}
                className="gap-2"
              >
                <FilePlus className="h-4 w-4" />
                <span className="hidden lg:inline">New File</span>
              </Button>
            </div>
          )}

          {/* User Menu */}
          {auth && user ? (
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="gap-2"
                onClick={onLogout}
              >
                <User className="h-4 w-4" />
                <span className="hidden sm:inline">{user}</span>
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          ) : auth ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={onLogin}
              className="gap-2"
            >
              <LogIn className="h-4 w-4" />
              <span className="hidden sm:inline">Login</span>
            </Button>
          ) : null}
        </div>
      </div>
    </header>
  );
}
