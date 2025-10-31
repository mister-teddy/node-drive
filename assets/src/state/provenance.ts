import { atomFamily } from "jotai/utils";
import { FileProps, Manifest, OtsInfo } from "../type";
import { atom } from "jotai";
import { fetchJsonWithError } from "../utils";

export const manifestAtomFamily = atomFamily((file: FileProps) =>
  atom(async () => {
    const url =
      file.type === "shared"
        ? `/share/${file.shareId}/manifest`
        : `/api/${file.filePath}?manifest=json`;

    return await fetchJsonWithError<Manifest>(url, "Failed to fetch manifest");
  })
);

export const otsInfoAtomFamily = atomFamily((file: FileProps) =>
  atom(async () => {
    const url =
      file.type === "shared"
        ? `/share/${file.shareId}/ots-info`
        : `/api/${file.filePath}?ots-info`;

    return await fetchJsonWithError<OtsInfo>(url, "Failed to fetch OTS info");
  })
);
