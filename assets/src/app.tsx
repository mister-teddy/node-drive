import { Suspense, useEffect, useTransition } from "react";
import { Flex, Layout, Typography, Spin } from "antd";
import { useLocation, useNavigate } from "react-router-dom";
import { useAtom, useSetAtom } from "jotai";
import FilesTable from "./components/files-table";
import { Header } from "./components/layout/header";
import { Breadcrumb } from "./components/layout/breadcrumb";
import UppyUploader from "./components/uppy-uploader";
import { uppyStore } from "./store/uppyStore";
import { apiPath } from "./utils";
import { currentLocationAtom, dataAtom } from "./state";

const { Content } = Layout;

// Re-export types for components
export type { PathItem, DATA } from "./state";

// Main content component wrapped in Suspense
function AppContent() {
  const [data, refreshData] = useAtom(dataAtom);
  const location = useLocation();
  const navigate = useNavigate();
  const setLocation = useSetAtom(currentLocationAtom);
  const [isPending, startTransition] = useTransition();

  // Sync location changes to Jotai state
  useEffect(() => {
    startTransition(() => {
      setLocation({
        pathname: location.pathname,
        search: location.search,
      });
    });
  }, [location.pathname, location.search, setLocation]);

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
      navigate("/");
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
      // Navigate to the new folder
      const folderPath = location.pathname.endsWith("/")
        ? location.pathname + name
        : location.pathname + "/" + name;
      navigate(folderPath);
    } catch (err) {
      alert(`Cannot create folder \`${name}\`, ${(err as Error).message}`);
    }
  };

  return (
    <Layout style={{ minHeight: "100vh", background: "#f5f5f5" }}>
      <Header
        auth={data.auth}
        user={data.user}
        allowUpload={data.allow_upload}
        allowSearch={data.allow_search}
        onSearch={(query: string) => {
          const href = location.pathname;
          navigate(query ? `${href}?q=${query}` : href);
        }}
        onLogin={async () => {
          try {
            await checkAuth("login");
          } catch {}
          refreshData();
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

      <Content style={{ padding: "0", position: "relative" }}>
        <Flex justify="space-between" align="center" gap="16px">
          <Breadcrumb href={data.href} uriPrefix={data.uri_prefix} />
          <Typography.Text type="secondary" style={{ padding: "0 24px" }}>
            Drop files anywhere to upload
          </Typography.Text>
        </Flex>

        {data.kind === "Index" && (
          <>
            <FilesTable loading={isPending} />
            {data.allow_upload && (
              <UppyUploader
                auth={data.auth}
                onAuthRequired={async () => {
                  await checkAuth();
                }}
                onUploadComplete={() => {
                  refreshData();
                }}
              />
            )}
          </>
        )}
      </Content>

      <style>{`
        @keyframes loadingBar {
          0% {
            transform: translateX(-100%);
          }
          100% {
            transform: translateX(100%);
          }
        }
      `}</style>
    </Layout>
  );
}

// App wrapper with Suspense boundary
function App() {
  return (
    <Suspense
      fallback={
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            minHeight: "100vh",
          }}
        >
          <Spin size="large" tip="Loading..." />
        </div>
      }
    >
      <AppContent />
    </Suspense>
  );
}

export default App;
