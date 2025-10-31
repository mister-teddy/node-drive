import { atom } from "jotai";
import { atomFamily } from "jotai/utils";
import {
  apiPath,
  fetchJson,
  fetchText,
  fetchJsonWithError,
  fetchStatus,
  fetchMutation,
} from "../utils";
import { lsdirDataAtom } from "./drive";

// ----- Share Info Fetching -----
export interface ShareInfo {
  share_id: string;
  file_path: string;
  file_sha256_hex: string;
  created_at: string;
  shared_by: string | null;
  owner_pubkey_hex: string;
  share_signature_hex: string;
  is_active: boolean;
  stamp_status?: {
    success: boolean;
    results?: {
      bitcoin: {
        timestamp: number;
        height: number;
      };
    };
    error?: string;
    sha256_hex?: string;
  };
}

export const shareInfoAtomFamily = atomFamily((shareId: string) =>
  atom(async () => {
    return await fetchJsonWithError<ShareInfo>(
      `/share/${shareId}/info`,
      "Share not found or expired"
    );
  })
);

// ----- File Content Fetching (for text files) -----
export const fileContentAtomFamily = atomFamily((fileName: string) =>
  atom(async () => {
    return await fetchText(apiPath(fileName));
  })
);

// ----- Mutation Atoms -----

// Share info types
export interface ShareInfoItem {
  share_id: string;
  share_url: string;
  created_at: string;
  shared_by: string | null;
  owner_pubkey: string;
  downloads: number;
}

interface ShareInfoResult {
  success: boolean;
  shares: ShareInfoItem[];
}

// Get share info for a file
export const getShareInfoAtom = atom(
  null,
  async (_get, _set, fileName: string) => {
    return await fetchJson<ShareInfoResult>(apiPath(fileName) + "?share_info");
  }
);

// Create share link
interface ShareLinkResult {
  success: boolean;
  share_url?: string;
}

export const createShareLinkAtom = atom(
  null,
  async (_get, set, fileName: string) => {
    const data = await fetchJson<ShareLinkResult>(
      apiPath(fileName) + "?share",
      {
        method: "POST",
      }
    );

    if (!data.success) {
      throw new Error("Failed to create share link");
    }

    // Refresh main data to update visibility
    set(lsdirDataAtom(fileName));

    return data;
  }
);

// Delete share link
export const deleteShareLinkAtom = atom(
  null,
  async (_get, set, shareId: string) => {
    await fetchMutation(`/share/${shareId}`, { method: "DELETE" });

    // Refresh main data to update visibility
    set(lsdirDataAtom(shareId));
  }
);

// Delete file
export const deleteFileAtom = atom(
  null,
  async (_get, set, fileName: string) => {
    await fetchMutation(apiPath(fileName), { method: "DELETE" });

    // Refresh main data after deletion
    set(lsdirDataAtom(fileName));
  }
);

// Move/rename file
interface MoveFileParams {
  fileName: string; // Can be relative (like "file.pdf") or absolute (like "/PDFs/file.pdf")
  destinationUrl: string;
}

export const moveFileAtom = atom(
  null,
  async (_get, set, params: MoveFileParams) => {
    // If fileName starts with /, it's an absolute path, so just prepend /api
    // Otherwise, use apiPath to resolve relative to current location
    const apiFileUrl = params.fileName.startsWith("/")
      ? "/api" + params.fileName
      : apiPath(params.fileName);

    await fetchMutation(apiFileUrl, {
      method: "MOVE",
      headers: {
        Destination: params.destinationUrl,
      },
    });

    // Refresh main data after move
    set(lsdirDataAtom(params.fileName));
  }
);

// Check if file exists (HEAD request)
export const checkFileExistsAtom = atom(
  null,
  async (_get, _set, apiFileUrl: string) => {
    return await fetchStatus(apiFileUrl, { method: "HEAD" });
  }
);
