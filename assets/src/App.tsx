import { useState, useEffect } from "react";
import { Flex, Layout, Typography } from "antd";
import { useLocation } from "react-router-dom";
import FilesTable from "./components/files-table";
import { Header } from "./components/layout/header";
import { Breadcrumb } from "./components/layout/breadcrumb";
import UppyUploader from "./components/uppy-uploader";
import { uppyStore } from "./store/uppyStore";
import { apiPath, filePath } from "./utils";

const { Content } = Layout;

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

export interface DATA {
  href: string;
  uri_prefix: string;
  kind: "Index" | "Edit" | "View";
  paths: PathItem[];
  allow_upload: boolean;
  allow_delete: boolean;
  allow_search: boolean;
  allow_archive: boolean;
  auth: boolean;
  user: string;
  dir_exists: boolean;
  editable: string;
}

function App() {
  const [data, setData] = useState<DATA | null>(null);
  const [loading, setLoading] = useState(true);
  const location = useLocation();

  useEffect(() => {
    // Fetch data from API endpoint
    const fetchData = async () => {
      setLoading(true);
      try {
        // Get current path from URL
        const currentPath = location.pathname;
        const searchParams = new URLSearchParams(location.search);

        // Build API URL - prepend /api to the current path
        let apiUrl = `/api${currentPath}`;

        // Preserve query parameters (like ?q=search)
        if (searchParams.toString()) {
          apiUrl += `?${searchParams.toString()}`;
        }

        const response = await fetch(apiUrl);
        if (!response.ok) {
          throw new Error(`Failed to fetch data: ${response.status}`);
        }

        const parsedData = await response.json();
        setData(parsedData);

        // Set document title
        if (parsedData.kind === "Index") {
          document.title = `Index of ${parsedData.href} - Node Drive`;
        } else if (parsedData.kind === "Edit") {
          document.title = `Edit ${parsedData.href} - Node Drive`;
        } else if (parsedData.kind === "View") {
          document.title = `View ${parsedData.href} - Node Drive`;
        }
      } catch (err) {
        console.error("Failed to fetch data:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [location.pathname, location.search]);

  const checkAuth = async (variant?: string) => {
    if (!data?.auth) return;
    const qs = variant ? `?${variant}` : "";
    const res = await fetch(apiPath() + qs, {
      method: "CHECKAUTH",
    });
    if (!(res.status >= 200 && res.status < 300)) {
      throw new Error((await res.text()) || `Invalid status ${res.status}`);
    }
  };

  const logout = () => {
    if (!data?.auth) return;
    const url = apiPath();
    const xhr = new XMLHttpRequest();
    xhr.open("LOGOUT", url, true, data.user);
    xhr.onload = () => {
      window.location.href = "/";
    };
    xhr.send();
  };

  const createFolder = async (name: string) => {
    const url = apiPath(name);
    try {
      await checkAuth();
      const res = await fetch(url, {
        method: "MKCOL",
      });
      if (!(res.status >= 200 && res.status < 300)) {
        throw new Error((await res.text()) || `Invalid status ${res.status}`);
      }
      window.location.href = filePath(name);
    } catch (err) {
      alert(`Cannot create folder \`${name}\`, ${(err as Error).message}`);
    }
  };

  if (loading) {
    return <div style={{ padding: "24px" }}>Loading...</div>;
  }

  if (!data) {
    return <div style={{ padding: "24px" }}>No data available</div>;
  }

  return (
    <Layout style={{ minHeight: "100vh", background: "#f5f5f5" }}>
      <Header
        auth={data.auth}
        user={data.user}
        allowUpload={data.allow_upload}
        allowSearch={data.allow_search}
        onSearch={(query: string) => {
          const href = location.pathname;
          window.location.href = query ? `${href}?q=${query}` : href;
        }}
        onLogin={async () => {
          try {
            await checkAuth("login");
          } catch {}
          window.location.reload();
        }}
        onLogout={logout}
        onNewFolder={() => {
          const name = prompt("Enter folder name");
          if (name) createFolder(name);
        }}
        onNewFile={() => {
          uppyStore.openFilePicker();
        }}
      />

      <Content style={{ padding: "0" }}>
        <Flex justify="space-between" align="center" gap="16px">
          <Breadcrumb href={data.href} uriPrefix={data.uri_prefix} />
          <Typography.Text type="secondary" style={{ padding: "0 24px" }}>
            Drop files anywhere to upload
          </Typography.Text>
        </Flex>

        {data.kind === "Index" && (
          <>
            <FilesTable DATA={data} />
            {data.allow_upload && (
              <UppyUploader
                auth={data.auth}
                onAuthRequired={async () => {
                  await checkAuth();
                }}
              />
            )}
          </>
        )}
      </Content>
    </Layout>
  );
}

export default App;
