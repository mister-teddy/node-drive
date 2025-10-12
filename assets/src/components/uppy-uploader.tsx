import { useState, useEffect } from "react";
import Uppy from "@uppy/core";
import { Dashboard } from "@uppy/react";
import DropTarget from "@uppy/drop-target";
import XHRUpload from "@uppy/xhr-upload";
import "@uppy/core/css/style.min.css";
import "@uppy/dashboard/css/style.min.css";

interface UppyUploaderProps {
  auth: boolean;
  onAuthRequired: () => Promise<void>;
}

export default function UppyUploader({
  auth,
  onAuthRequired,
}: UppyUploaderProps) {
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [hasFiles, setHasFiles] = useState(false);

  const [uppy] = useState(() => {
    const uppyInstance = new Uppy({
      autoProceed: false,
      restrictions: {
        maxNumberOfFiles: null,
      },
    })
      .use(XHRUpload, {
        endpoint: (file: any) => {
          const currentPath = window.location.pathname;
          const fileName = encodeURIComponent(file.name);
          return `${currentPath}${
            currentPath.endsWith("/") ? "" : "/"
          }${fileName}`;
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
          setIsDraggingOver(true);
        },
        onDragLeave: () => {
          setIsDraggingOver(false);
        },
        onDrop: () => {
          setIsDraggingOver(false);
        },
      });

    uppyInstance.on("upload-success", (file: any, response: any) => {
      console.log("Upload successful:", file?.name, response);
      setTimeout(() => {
        location.reload();
      }, 1000);
    });

    uppyInstance.on("complete", (result: any) => {
      console.log("Upload complete:", result);
      if (result.successful.length > 0) {
        const emptyFolder = document.querySelector(".empty-folder");
        if (emptyFolder && !emptyFolder.classList.contains("hidden")) {
          emptyFolder.classList.add("hidden");
        }
      }
    });

    // Track when files are added or removed
    uppyInstance.on("file-added", () => {
      setHasFiles(uppyInstance.getFiles().length > 0);
      if (auth) {
        onAuthRequired().catch((err) => {
          console.error("Authentication required:", err);
        });
      }
    });

    uppyInstance.on("file-removed", () => {
      setHasFiles(uppyInstance.getFiles().length > 0);
    });

    uppyInstance.on("cancel-all", () => {
      setHasFiles(false);
    });

    return uppyInstance;
  });

  useEffect(() => {
    return () => {
      uppy.cancelAll();
    };
  }, [uppy]);

  const showDashboard = hasFiles && !isDraggingOver;

  return (
    <>
      {/* Full-screen drag overlay */}
      {isDraggingOver && (
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
          }}
        >
          <div
            style={{
              fontSize: "32px",
              fontWeight: 600,
              color: "#007bff",
              textAlign: "center",
              textShadow: "0 2px 4px rgba(0,0,0,0.1)",
            }}
          >
            Drop files anywhere to upload
          </div>
        </div>
      )}

      {/* Floating Dashboard at bottom right */}
      {showDashboard && (
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
      )}
    </>
  );
}
