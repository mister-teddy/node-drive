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
} from "../store/uppyStore";
import { apiPath } from "../utils";

interface UppyUploaderProps {
  auth: boolean;
  onAuthRequired: () => Promise<void>;
  onUploadComplete: () => void;
}

const UppyUploader = ({ auth, onAuthRequired, onUploadComplete }: UppyUploaderProps) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

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
        endpoint: (file: any) => {
          // Use apiPath to get the correct /api prefix
          return apiPath(file.name);
        },
        method: "PUT",
        formData: false,
        fieldName: "file",
        allowedMetaFields: [],
        timeout: 120000,
        getResponseData(xhr: any) {
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

    uppyInstance.on("upload-success", (file: any, response: any) => {
      console.log("Upload successful:", file?.name, response);
    });

    uppyInstance.on("complete", (result: any) => {
      console.log("Upload complete:", result);
      if (result.successful.length > 0) {
        const emptyFolder = document.querySelector(".empty-folder");
        if (emptyFolder && !emptyFolder.classList.contains("hidden")) {
          emptyFolder.classList.add("hidden");
        }
        // Refetch data to show uploaded files
        setTimeout(() => {
          onUploadComplete();
        }, 500);
      }
    });

    return uppyInstance;
  });

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
    setFilePickerTrigger(() => {
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
        style={{ display: "none" }}
        onChange={handleFileChange}
      />

      {/* Full-screen drag overlay */}
      {isDraggingOver ? (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0, 123, 255, 0.1)",
            border: "3px dashed #007bff",
            zIndex: 9998,
            pointerEvents: "none",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            textAlign: "center",
            color: "#007bff",
          }}
        >
          <h2>Drop files here to upload</h2>
        </div>
      ) : (
        showDashboard && (
          <div
            style={{
              position: "fixed",
              bottom: "24px",
              right: "24px",
              width: "450px",
              maxWidth: "calc(100vw - 48px)",
              zIndex: 1000,
              borderRadius: "12px",
              boxShadow: "0 8px 32px rgba(0, 0, 0, 0.15)",
              overflow: "hidden",
            }}
          >
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
}

export default UppyUploader;
