// @ts-check

import { createElement } from "https://esm.sh/react@18";

export default function UploadButton({ DATA }) {
  console.log({ DATA });

  if (!DATA.allow_upload) {
    return null;
  }

  return createElement(
    "div",
    { className: "control upload-file", title: "Upload files" },
    createElement(
      "label",
      { htmlFor: "file" },
      createElement(
        "svg",
        { width: "16", height: "16", viewBox: "0 0 16 16" },
        createElement("path", {
          d: "M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5z",
        }),
        createElement("path", {
          d: "M7.646 1.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1-.708.708L8.5 2.707V11.5a.5.5 0 0 1-1 0V2.707L5.354 4.854a.5.5 0 1 1-.708-.708l3-3z",
        }),
      ),
    ),
    createElement("input", {
      type: "file",
      id: "file",
      title: "Upload files",
      name: "file",
      multiple: true,
      onChange: async (e) => {
        const files = e.target.files;
        for (let file of files) {
          new Uploader(file, []).upload();
        }
      },
    }),
  );
}
