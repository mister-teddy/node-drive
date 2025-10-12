import { useState, useEffect } from 'react';
import { Layout } from 'antd';
import FilesTable from './components/files-table';
import { Header } from './components/layout/header';
import { Breadcrumb } from './components/layout/breadcrumb';
import UppyUploader from './components/uppy-uploader';
import { decodeBase64 } from './utils';

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

  useEffect(() => {
    // Load data from the embedded script tag
    const $indexData = document.getElementById("index-data");
    if ($indexData) {
      try {
        const parsedData = JSON.parse(decodeBase64($indexData.innerHTML));
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
        console.error("Failed to parse data:", err);
      }
    }
    setLoading(false);
  }, []);

  const baseUrl = (): string => {
    return window.location.href.split(/[?#]/)[0];
  };

  const newUrl = (name: string): string => {
    let url = baseUrl();
    if (!url.endsWith("/")) url += "/";
    url += name.split("/").map(encodeURIComponent).join("/");
    return url;
  };

  const checkAuth = async (variant?: string) => {
    if (!data?.auth) return;
    const qs = variant ? `?${variant}` : "";
    const res = await fetch(baseUrl() + qs, {
      method: "CHECKAUTH",
    });
    if (!(res.status >= 200 && res.status < 300)) {
      throw new Error((await res.text()) || `Invalid status ${res.status}`);
    }
  };

  const logout = () => {
    if (!data?.auth) return;
    const url = baseUrl();
    const xhr = new XMLHttpRequest();
    xhr.open("LOGOUT", url, true, data.user);
    xhr.onload = () => {
      window.location.href = url;
    };
    xhr.send();
  };

  const createFolder = async (name: string) => {
    const url = newUrl(name);
    try {
      await checkAuth();
      const res = await fetch(url, {
        method: "MKCOL",
      });
      if (!(res.status >= 200 && res.status < 300)) {
        throw new Error((await res.text()) || `Invalid status ${res.status}`);
      }
      window.location.href = url;
    } catch (err) {
      alert(`Cannot create folder \`${name}\`, ${(err as Error).message}`);
    }
  };

  const createFile = async (name: string) => {
    const url = newUrl(name);
    try {
      await checkAuth();
      const res = await fetch(url, {
        method: "PUT",
        body: "",
      });
      if (!(res.status >= 200 && res.status < 300)) {
        throw new Error((await res.text()) || `Invalid status ${res.status}`);
      }
      window.location.href = url + "?edit";
    } catch (err) {
      alert(`Cannot create file \`${name}\`, ${(err as Error).message}`);
    }
  };

  if (loading) {
    return <div style={{ padding: '24px' }}>Loading...</div>;
  }

  if (!data) {
    return <div style={{ padding: '24px' }}>No data available</div>;
  }

  return (
    <Layout style={{ minHeight: '100vh', background: '#f5f5f5' }}>
      <Header
        auth={data.auth}
        user={data.user}
        allowUpload={data.allow_upload}
        allowSearch={data.allow_search}
        onSearch={(query: string) => {
          const href = baseUrl();
          window.location.href = query ? `${href}?q=${query}` : href;
        }}
        onLogin={async () => {
          try {
            await checkAuth("login");
          } catch { }
          window.location.reload();
        }}
        onLogout={logout}
        onNewFolder={() => {
          const name = prompt("Enter folder name");
          if (name) createFolder(name);
        }}
        onNewFile={() => {
          const name = prompt("Enter file name");
          if (name) createFile(name);
        }}
      />

      <Content style={{ padding: '0' }}>
        <Breadcrumb href={data.href} uriPrefix={data.uri_prefix} />

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
