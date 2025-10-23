import { Suspense, useEffect } from "react";
import { Flex, Layout, Typography, Spin, Modal, Input } from "antd";
import { useLocation, useNavigate, Routes, Route } from "react-router-dom";
import { useAtomValue, useSetAtom } from "jotai";
import FilesTable from "./components/files-table";
import { Header } from "./components/layout/header";
import { Breadcrumb } from "./components/layout/breadcrumb";
import UppyUploader from "./components/uppy-uploader";
import SharePage from "./components/share-page";
import { filePickerTriggerAtom } from "./store/uppyStore";
import { apiPath } from "./utils";
import { currentLocationAtom, dataAtom, metadataAtom, authAtom, permissionsAtom } from "./state";

const { Content } = Layout;

// Re-export types for components
export type { PathItem, DATA } from "./state";

// Main content component wrapped in Suspense
function AppContent() {
  // Use focused atoms for better granularity
  const metadata = useAtomValue(metadataAtom);
  const auth = useAtomValue(authAtom);
  const permissions = useAtomValue(permissionsAtom);
  const refreshData = useSetAtom(dataAtom);

  const location = useLocation();
  const navigate = useNavigate();
  const setLocation = useSetAtom(currentLocationAtom);
  const filePickerTrigger = useAtomValue(filePickerTriggerAtom);

  // Sync location changes to Jotai state
  useEffect(() => {
    setLocation({
      pathname: location.pathname,
      search: location.search,
    });
  }, [location.pathname, location.search, setLocation]);

  const checkAuth = async (variant?: string) => {
    if (!auth?.auth) return;
    const qs = variant ? `?${variant}` : "";
    const res = await fetch(apiPath() + qs, {
      method: "CHECKAUTH",
    });
    if (!(res.status >= 200 && res.status < 300)) {
      throw new Error((await res.text()) || `Invalid status ${res.status}`);
    }
  };

  const logout = () => {
    if (!auth?.auth) return;
    const url = apiPath();
    const xhr = new XMLHttpRequest();
    xhr.open("LOGOUT", url, true, auth.user);
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
      Modal.error({
        title: "Create folder failed",
        content: `Cannot create folder "${name}": ${(err as Error).message}`,
      });
    }
  };

  return (
    <Routes>
      {/* Share page route */}
      <Route path="/share/:shareId" element={<SharePage />} />

      {/* Main file browser route */}
      <Route
        path="*"
        element={
          <Layout style={{ minHeight: "100vh", background: "#f5f5f5" }}>
            <Header
              auth={auth.auth}
              user={auth.user}
              allowUpload={permissions.allow_upload}
              allowSearch={permissions.allow_search}
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
                let folderName = "";
                Modal.confirm({
                  title: "Create new folder",
                  content: (
                    <Input
                      placeholder="Enter folder name"
                      onChange={(e) => {
                        folderName = e.target.value;
                      }}
                      onPressEnter={() => {
                        Modal.destroyAll();
                        if (folderName.trim()) createFolder(folderName.trim());
                      }}
                      autoFocus
                    />
                  ),
                  okText: "Create",
                  cancelText: "Cancel",
                  onOk: () => {
                    if (folderName.trim()) {
                      createFolder(folderName.trim());
                    }
                  },
                });
              }}
              onNewFile={() => {
                if (filePickerTrigger) {
                  filePickerTrigger();
                }
              }}
            />

            <Content style={{ padding: "0", position: "relative" }}>
              <Flex justify="space-between" align="center" gap="16px">
                <Breadcrumb href={metadata.href} uriPrefix={metadata.uri_prefix} />
                <Typography.Text type="secondary" style={{ padding: "0 24px" }}>
                  Drop files anywhere to upload
                </Typography.Text>
              </Flex>

              {metadata.kind === "Index" && (
                <>
                  <FilesTable />
                  {permissions.allow_upload && (
                    <UppyUploader
                      auth={auth.auth}
                      onAuthRequired={async () => {
                        await checkAuth();
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
        }
      />
    </Routes>
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
