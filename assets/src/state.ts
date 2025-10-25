import { atom } from "jotai";
import { atomWithRefresh, loadable, atomFamily } from "jotai/utils";
import { apiPath } from "./utils";

export interface PathItem {
  path_type: "Dir" | "SymlinkDir" | "File" | "SymlinkFile";
  name: string;
  mtime: number;
  size: number;
  sha256?: string;
  provenance?: {
    events: Array<Record<string, unknown>>;
  };
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

export interface DATA {
  href: string;
  uri_prefix: string;
  kind: "Index" | "Edit" | "View";
  paths: PathItem[];
  allow_upload: boolean;
  allow_delete: boolean;
  allow_search: boolean;
  allow_archive: boolean;
  auth: boolean;
  user: string;
  dir_exists: boolean;
  editable: string;
}

// Current location state (pathname + search)
export const currentLocationAtom = atom({
  pathname: window.location.pathname,
  search: window.location.search,
});

// Async data fetcher with refresh capability
export const dataAtom = atomWithRefresh(async (get) => {
  const location = get(currentLocationAtom);
  const currentPath = location.pathname;
  const searchParams = new URLSearchParams(location.search);

  // Build API URL - prepend /api to the current path
  let apiUrl = `/api${currentPath}`;

  // Preserve query parameters (like ?q=search)
  if (searchParams.toString()) {
    apiUrl += `?${searchParams.toString()}`;
  }

  const response = await fetch(apiUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch data: ${response.status}`);
  }

  const parsedData: DATA = await response.json();

  // Set document title
  if (parsedData.kind === "Index") {
    document.title = `Index of ${parsedData.href} - Node Drive`;
  } else if (parsedData.kind === "Edit") {
    document.title = `Edit ${parsedData.href} - Node Drive`;
  } else if (parsedData.kind === "View") {
    document.title = `View ${parsedData.href} - Node Drive`;
  }

  return parsedData;
});

// Loadable wrapper - use this to avoid Suspense and show loading states
export const loadableDataAtom = loadable(dataAtom);

// Synchronous focused atoms derived from loadableDataAtom
// These preserve previous data during loading to avoid showing empty states

const pathsCache = { current: [] as PathItem[] };
export const pathsAtom = atom((get) => {
  const loadableData = get(loadableDataAtom);
  if (loadableData.state === "hasData") {
    pathsCache.current = loadableData.data.paths || [];
    return pathsCache.current;
  }
  // Return cached data during loading
  return pathsCache.current;
});

const metadataCache = {
  current: {
    href: "/",
    uri_prefix: "",
    kind: "Index" as "Index" | "Edit" | "View",
    dir_exists: true,
  }
};
export const metadataAtom = atom((get) => {
  const loadableData = get(loadableDataAtom);
  if (loadableData.state === "hasData") {
    metadataCache.current = {
      href: loadableData.data.href,
      uri_prefix: loadableData.data.uri_prefix,
      kind: loadableData.data.kind,
      dir_exists: loadableData.data.dir_exists,
    };
    return metadataCache.current;
  }
  // Return cached data during loading
  return metadataCache.current;
});

const permissionsCache = {
  current: {
    allow_upload: false,
    allow_delete: false,
    allow_search: false,
    allow_archive: false,
  }
};
export const permissionsAtom = atom((get) => {
  const loadableData = get(loadableDataAtom);
  if (loadableData.state === "hasData") {
    permissionsCache.current = {
      allow_upload: loadableData.data.allow_upload,
      allow_delete: loadableData.data.allow_delete,
      allow_search: loadableData.data.allow_search,
      allow_archive: loadableData.data.allow_archive,
    };
    return permissionsCache.current;
  }
  // Return cached data during loading
  return permissionsCache.current;
});

const authCache = {
  current: {
    auth: false,
    user: "",
  }
};
export const authAtom = atom((get) => {
  const loadableData = get(loadableDataAtom);
  if (loadableData.state === "hasData") {
    authCache.current = {
      auth: loadableData.data.auth,
      user: loadableData.data.user,
    };
    return authCache.current;
  }
  // Return cached data during loading
  return authCache.current;
});

// Legacy atoms for backward compatibility
export const allowUploadAtom = atom((get) => {
  const perms = get(permissionsAtom);
  return perms.allow_upload;
});

export const allowDeleteAtom = atom((get) => {
  const perms = get(permissionsAtom);
  return perms.allow_delete;
});

export const allowArchiveAtom = atom((get) => {
  const perms = get(permissionsAtom);
  return perms.allow_archive;
});

// ============================================================================
// Fetch Atoms - All fetch logic moved here from components
// ============================================================================

// ----- Manifest Fetching -----
interface ManifestParams {
  fileName: string;
  shareId?: string;
}

export interface ProvenanceEvent {
  action: string;
  issued_at: string;
  actors?: {
    creator_pubkey_hex?: string;
    new_owner_pubkey_hex?: string;
  };
  signatures?: {
    creator_sig_hex?: string;
    new_owner_sig_hex?: string;
  };
  ots_proof_b64?: string;
  prev_event_hash_hex?: string;
}

export interface Manifest {
  type?: string;
  artifact?: {
    sha256_hex: string;
    verified_chain?: string;
    verified_timestamp?: number;
    verified_height?: number;
  };
  events?: ProvenanceEvent[];
}

export const manifestAtomFamily = atomFamily((params: ManifestParams) =>
  atom(async () => {
    const url = params.shareId
      ? `/share/${params.shareId}/manifest`
      : apiPath(params.fileName) + "?manifest=json";

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to fetch manifest: ${response.status}`);
    }

    const manifestData: Manifest = await response.json();
    return manifestData;
  })
);

// ----- OTS Info Fetching -----
interface OtsInfoParams {
  fileName: string;
  shareId?: string;
}

interface OtsInfo {
  file_hash: string;
  operations: string[];
}

export const otsInfoAtomFamily = atomFamily((params: OtsInfoParams) =>
  atom(async () => {
    const url = params.shareId
      ? `/share/${params.shareId}/ots-info`
      : apiPath(params.fileName) + "?ots-info";

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to fetch OTS info: ${response.status}`);
    }

    const info: OtsInfo = await response.json();
    return info;
  })
);

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
    const response = await fetch(`/share/${shareId}/info`);

    if (!response.ok) {
      throw new Error("Share not found or expired");
    }

    const data: ShareInfo = await response.json();
    return data;
  })
);

// ----- File Content Fetching (for text files) -----
export const fileContentAtomFamily = atomFamily((fileName: string) =>
  atom(async () => {
    const fileUrl = apiPath(fileName);
    const response = await fetch(fileUrl);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const text = await response.text();
    return text;
  })
);

// ----- Mutation Atoms -----

// Create share link
interface ShareLinkResult {
  success: boolean;
  share_url?: string;
}

export const createShareLinkAtom = atom(
  null,
  async (_get, _set, fileName: string) => {
    const url = apiPath(fileName) + "?share";
    const response = await fetch(url, {
      method: "POST",
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data: ShareLinkResult = await response.json();

    if (!data.success) {
      throw new Error("Failed to create share link");
    }

    return data;
  }
);

// Delete file
export const deleteFileAtom = atom(
  null,
  async (_get, set, fileName: string) => {
    const url = apiPath(fileName);
    const response = await fetch(url, {
      method: "DELETE",
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    // Refresh main data after deletion
    set(dataAtom);
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

    const response = await fetch(apiFileUrl, {
      method: "MOVE",
      headers: {
        Destination: params.destinationUrl,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `HTTP ${response.status}: ${errorText || response.statusText}`
      );
    }

    // Refresh main data after move
    set(dataAtom);
  }
);

// Check if file exists (HEAD request)
export const checkFileExistsAtom = atom(
  null,
  async (_get, _set, apiFileUrl: string) => {
    const response = await fetch(apiFileUrl, {
      method: "HEAD",
    });

    return response.status === 200;
  }
);
