// @ts-check

import {
  useState,
  useEffect,
  createElement,
} from "https://esm.sh/react@18.3.1";
import { autorun, toJS, store } from "../utils.js";

export default function UploadTable({ DATA }) {
  const [queue, setQueue] = useState([]);
  console.log({ queue });

  useEffect(() => {
    autorun(() => {
      setQueue(toJS(store.uploadQueue));
    });
  }, []);

  const formatFileSize = (bytes) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const getStatus = (file) => {
    if (file.uploaded === file.file?.size) {
      return "Completed";
    } else if (file.uploadOffset > 0) {
      return "Uploading";
    } else {
      return "Pending";
    }
  };
  return createElement(
    "table",
    { className: "control upload-file", title: "Upload files" },
    createElement(
      "thead",
      null,
      createElement(
        "tr",
        null,
        createElement("th", null, "File Name"),
        createElement("th", null, "Size"),
        createElement("th", null, "Status"),
        createElement("th", null, "SHA256"),
      ),
    ),
    createElement(
      "tbody",
      null,
      queue.map((file, index) =>
        createElement(
          "tr",
          { key: file.result?.idx || index },
          createElement("td", null, file.result?.name),
          createElement(
            "td",
            null,
            formatFileSize(file.file?.size || file.result?.uploaded),
          ),
          createElement("td", null, getStatus(file.result)),
          createElement("td", null, file.sha256),
        ),
      ),
    ),
    createElement(
      "tfoot",
      null,
      createElement(
        "tr",
        null,
        createElement("td", { colSpan: 4 }, "Total Files: ", queue.length),
      ),
    ),
  );
}
