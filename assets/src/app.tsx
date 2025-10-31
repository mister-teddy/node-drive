import { Suspense } from "react";
import { Flex, Layout, Typography, Spin, Modal, Input } from "antd";
import { useLocation, useNavigate, Routes, Route } from "react-router-dom";
import { useAtomValue } from "jotai";
import FilesTable from "./components/files-table";
import { Header } from "./components/layout/header";
import { Breadcrumb } from "./components/layout/breadcrumb";
import UppyUploader from "./components/uppy-uploader";
import SharePage from "./components/share-page";
import { filePickerTriggerAtom } from "./state/uppy";
import { apiPath } from "./utils";
import { lsdirDataAtom } from "./state/drive";

const { Content } = Layout;

// Main content component wrapped in Suspense
function AppContent() {
  const navigate = useNavigate();
  const location = useLocation();
  const metadata = useAtomValue(lsdirDataAtom(location.pathname));
  const filePickerTrigger = useAtomValue(filePickerTriggerAtom);

  const createFolder = async (name: string) => {
    const url = apiPath(name);
    try {
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
          <Layout className="h-screen bg-gray-100">
            <Header
              onSearch={(query: string) => {
                const href = location.pathname;
                navigate(query ? `${href}?q=${query}` : href);
              }}
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

            <Content className="p-0 relative flex-1 overflow-y-auto">
              <Flex justify="space-between" align="center" gap="16px">
                <Breadcrumb
                  href={metadata.href}
                  uriPrefix={metadata.uri_prefix}
                />
                <Typography.Text type="secondary" className="px-6">
                  Drop files anywhere to upload
                </Typography.Text>
              </Flex>

              {metadata.kind === "Index" && (
                <>
                  <FilesTable />
                  <UppyUploader
                    auth={false}
                    onAuthRequired={async () => {
                      debugger;
                    }}
                  />
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
        <div className="flex justify-center items-center min-h-screen">
          <Spin size="large" tip="Loading..." />
        </div>
      }
    >
      <AppContent />
    </Suspense>
  );
}

export default App;
