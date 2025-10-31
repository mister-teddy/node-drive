import { useState, useEffect, useRef } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import Uppy from "@uppy/core";
import { Dashboard } from "@uppy/react";
import DropTarget from "@uppy/drop-target";
import XHRUpload from "@uppy/xhr-upload";
import "@uppy/core/css/style.min.css";
import "@uppy/dashboard/css/style.min.css";
import {
  isDraggingOverAtom,
  hasFilesAtom,
  filePickerTriggerAtom,
  showDashboardAtom,
  setIsDraggingOverWithDelay,
} from "../state/uppy";
import { apiPath } from "../utils";
import { useRefreshData } from "../state/drive";

interface UppyUploaderProps {
  auth: boolean;
  onAuthRequired: () => Promise<void>;
}

const UppyUploader = ({ auth, onAuthRequired }: UppyUploaderProps) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const refreshData = useRefreshData();

  const [isDraggingOver, setIsDraggingOver] = useAtom(isDraggingOverAtom);
  const setHasFiles = useSetAtom(hasFilesAtom);
  const setFilePickerTrigger = useSetAtom(filePickerTriggerAtom);
  const showDashboard = useAtomValue(showDashboardAtom);

  const [uppy] = useState(() => {
    const uppyInstance = new Uppy({
      autoProceed: false,
      restrictions: {
        maxNumberOfFiles: null,
      },
    })
      .use(XHRUpload, {
        endpoint: (file) => {
          // Use apiPath to get the correct /api prefix
          const fileName = (Array.isArray(file) ? file[0] : file).name;
          return apiPath(fileName);
        },
        method: "PUT",
        formData: false,
        fieldName: "file",
        allowedMetaFields: [],
        timeout: 120000,
        getResponseData(xhr) {
          try {
            const response = JSON.parse(xhr.responseText);
            return {
              url:
                window.location.pathname +
                encodeURIComponent(response.filename),
              sha256: response.sha256,
              ots_base64: response.ots_base64,
              event_hash: response.event_hash,
              issued_at: response.issued_at,
              stamp_status: response.stamp_status,
            };
          } catch {
            return { url: xhr.responseURL };
          }
        },
      })
      .use(DropTarget, {
        target: document.body,
        onDragOver: () => {
          setIsDraggingOverWithDelay(setIsDraggingOver, true);
        },
        onDragLeave: () => {
          setIsDraggingOverWithDelay(setIsDraggingOver, false);
        },
        onDrop: () => {
          setIsDraggingOverWithDelay(setIsDraggingOver, false);
        },
      });

    uppyInstance.on("upload-success", (file, response) => {
      console.log("Upload successful:", file?.name, response);
    });

    return uppyInstance;
  });

  // Handle upload completion
  useEffect(() => {
    const handleComplete = (result: any) => {
      console.log("Upload complete:", result);
      const successCount = result.successful?.length ?? 0;
      if (successCount > 0) {
        const emptyFolder = document.querySelector(".empty-folder");
        if (emptyFolder && !emptyFolder.classList.contains("hidden")) {
          emptyFolder.classList.add("hidden");
        }
        // Refetch data to show uploaded files
        const failedCount = result.failed?.length ?? 0;
        setHasFiles(failedCount > 0);
        refreshData();
      }
    };

    uppy.on("complete", handleComplete);

    return () => {
      uppy.off("complete", handleComplete);
    };
  }, [uppy, refreshData, setHasFiles]);

  // Track when files are added or removed
  useEffect(() => {
    const handleFileAdded = () => {
      setHasFiles(uppy.getFiles().length > 0);
      if (auth) {
        onAuthRequired().catch((err) => {
          console.error("Authentication required:", err);
        });
      }
    };

    const handleFileRemoved = () => {
      setHasFiles(uppy.getFiles().length > 0);
    };

    const handleCancelAll = () => {
      setHasFiles(false);
    };

    uppy.on("file-added", handleFileAdded);
    uppy.on("file-removed", handleFileRemoved);
    uppy.on("cancel-all", handleCancelAll);

    return () => {
      uppy.off("file-added", handleFileAdded);
      uppy.off("file-removed", handleFileRemoved);
      uppy.off("cancel-all", handleCancelAll);
      uppy.cancelAll();
    };
  }, [uppy, auth, onAuthRequired, setHasFiles]);

  useEffect(() => {
    // Register the file picker trigger function with the store
    setFilePickerTrigger(() => () => {
      fileInputRef.current?.click();
    });
  }, [setFilePickerTrigger]);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files) {
      Array.from(files).forEach((file) => {
        uppy.addFile({
          name: file.name,
          type: file.type,
          data: file,
        });
      });
    }
    // Reset the input so the same file can be selected again
    event.target.value = "";
  };

  return (
    <>
      {/* Hidden file input for programmatic file selection */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Full-screen drag overlay */}
      {isDraggingOver ? (
        <div className="fixed inset-0 bg-blue-500/10 border-[3px] border-dashed border-blue-500 z-9998 pointer-events-none flex items-center justify-center text-center text-blue-500">
          <h2>Drop files here to upload</h2>
        </div>
      ) : (
        showDashboard && (
          <div className="fixed bottom-6 right-6 w-[450px] max-w-[calc(100vw-48px)] z-1000 rounded-xl shadow-[0_8px_32px_rgba(0,0,0,0.15)] overflow-hidden">
            <Dashboard
              uppy={uppy}
              hideProgressAfterFinish={false}
              note="Upload files to create digital provenance records with Bitcoin timestamps"
              proudlyDisplayPoweredByUppy={false}
              height={400}
            />
          </div>
        )
      )}
    </>
  );
};

export default UppyUploader;
