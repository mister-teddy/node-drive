// @ts-check

import {
  useState,
  useEffect,
  createElement,
} from "https://esm.sh/react@18.3.1";
import { autorun, store } from "../utils.js";

export default function UploadTable({ DATA }) {
  const [queue, setQueue] = useState([]);
  console.log({ queue });

  useEffect(() => {
    autorun(() => {
      setQueue(store.uploadQueue);
    });
  }, []);

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
      ),
    ),
    createElement(
      "tbody",
      null,
      queue.map((file) =>
        createElement(
          "tr",
          null,
          createElement("td", null, file.name),
          createElement("td", null, file.size),
          createElement("td", null, "Pending"),
        ),
      ),
    ),
    createElement(
      "tfoot",
      null,
      createElement(
        "tr",
        null,
        createElement("td", { colSpan: 3 }, "Total Files: ", DATA.length),
      ),
    ),
  );
}
