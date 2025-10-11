import { useState } from 'react';
import {
  Folder,
  File,
  FileText,
  FileImage,
  FileVideo,
  FileAudio,
  FileArchive,
  FileCode,
  Download,
  Trash2,
  Move,
  Check,
  Clock,
} from 'lucide-react';
import { formatMtime, formatFileSize, formatDirSize } from '../utils';
import { Button } from './ui/button';
import { cn } from '../lib/utils';

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

interface FilesTableModernProps {
  DATA: DATA;
}

export default function FilesTableModern({ DATA }: FilesTableModernProps) {
  const [paths, setPaths] = useState(DATA.paths || []);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

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
      return <Folder className="h-5 w-5 text-blue-500" />;
    }

    const ext = file.name.split('.').pop()?.toLowerCase() || '';

    // Images
    if (['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp', 'bmp'].includes(ext)) {
      return <FileImage className="h-5 w-5 text-green-500" />;
    }
    // Videos
    if (['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(ext)) {
      return <FileVideo className="h-5 w-5 text-purple-500" />;
    }
    // Audio
    if (['mp3', 'wav', 'ogg', 'flac', 'm4a'].includes(ext)) {
      return <FileAudio className="h-5 w-5 text-pink-500" />;
    }
    // Archives
    if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) {
      return <FileArchive className="h-5 w-5 text-orange-500" />;
    }
    // Code
    if (['js', 'ts', 'jsx', 'tsx', 'py', 'java', 'cpp', 'rs', 'go'].includes(ext)) {
      return <FileCode className="h-5 w-5 text-blue-600" />;
    }
    // Text
    if (['txt', 'md', 'json', 'xml', 'yaml', 'yml'].includes(ext)) {
      return <FileText className="h-5 w-5 text-gray-500" />;
    }

    return <File className="h-5 w-5 text-gray-400" />;
  };

  const renderVerificationBadge = (file: PathItem) => {
    if (!file.stamp_status) return null;

    const isPending = typeof file.stamp_status === 'string' || !file.stamp_status.success;

    return (
      <div
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
          isPending
            ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400"
            : "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
        )}
      >
        {isPending ? (
          <>
            <Clock className="h-3 w-3" />
            Pending
          </>
        ) : (
          <>
            <Check className="h-3 w-3" />
            Verified
          </>
        )}
      </div>
    );
  };

  const handleDelete = async (index: number) => {
    const file = paths[index];
    if (!file) return;

    if (!confirm(`Delete "${file.name}"?`)) return;

    try {
      const url = newUrl(file.name);
      const res = await fetch(url, {
        method: "DELETE",
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      const newPaths = [...paths];
      newPaths.splice(index, 1);
      setPaths(newPaths);
    } catch (err) {
      const error = err as Error;
      alert(`Cannot delete "${file.name}": ${error.message}`);
    }
  };

  const handleMove = async (index: number) => {
    const file = paths[index];
    if (!file) return;

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

  if (!paths || paths.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Folder className="h-16 w-16 text-muted-foreground/50 mb-4" />
        <h3 className="text-lg font-medium text-foreground mb-2">
          This folder is empty
        </h3>
        <p className="text-sm text-muted-foreground">
          Upload files or create a new folder to get started
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-1 py-4">
      {paths.map((file: PathItem, index: number) => {
        const isDir = file.path_type.endsWith("Dir");
        const url = newUrl(file.name) + (isDir ? "/" : "");
        const sizeDisplay = isDir
          ? formatDirSize(file.size)
          : formatFileSize(file.size).join(" ");

        return (
          <div
            key={index}
            className={cn(
              "group relative flex items-center gap-4 rounded-lg px-4 py-3 transition-colors",
              "hover:bg-accent/50",
              hoveredIndex === index && "bg-accent/30"
            )}
            onMouseEnter={() => setHoveredIndex(index)}
            onMouseLeave={() => setHoveredIndex(null)}
          >
            {/* Icon + Name */}
            <div className="flex min-w-0 flex-1 items-center gap-3">
              {getFileIcon(file)}
              <div className="min-w-0 flex-1">
                <a
                  href={url}
                  target={isDir ? undefined : "_blank"}
                  className="block truncate font-medium text-foreground hover:text-primary transition-colors"
                >
                  {file.name}
                </a>
              </div>
            </div>

            {/* Verification Badge */}
            <div className="hidden sm:block">
              {!isDir && renderVerificationBadge(file)}
            </div>

            {/* Size */}
            <div className="hidden md:block text-sm text-muted-foreground w-24 text-right">
              {sizeDisplay}
            </div>

            {/* Modified Date */}
            <div className="hidden lg:block text-sm text-muted-foreground w-36 text-right">
              {formatMtime(file.mtime)}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                asChild
              >
                <a
                  href={url + (isDir && DATA.allow_archive ? "?zip" : "")}
                  download
                  title={isDir ? "Download folder as zip" : "Download file"}
                >
                  <Download className="h-4 w-4" />
                </a>
              </Button>

              {DATA.allow_upload && DATA.allow_delete && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => handleMove(index)}
                  title="Move to new path"
                >
                  <Move className="h-4 w-4" />
                </Button>
              )}

              {DATA.allow_delete && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive hover:text-destructive"
                  onClick={() => handleDelete(index)}
                  title="Delete"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
