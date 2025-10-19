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

// Loadable wrapper for Suspense integration
export const loadableDataAtom = loadable(dataAtom);

// Derived/selector atoms
export const pathsAtom = atom(async (get) => {
  const data = await get(dataAtom);
  return data.paths || [];
});

export const allowUploadAtom = atom(async (get) => {
  const data = await get(dataAtom);
  return data.allow_upload;
});

export const allowDeleteAtom = atom(async (get) => {
  const data = await get(dataAtom);
  return data.allow_delete;
});

export const allowArchiveAtom = atom(async (get) => {
  const data = await get(dataAtom);
  return data.allow_archive;
});
