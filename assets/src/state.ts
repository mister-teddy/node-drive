import { atom } from "jotai";
import { atomWithRefresh, loadable } from "jotai/utils";

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
