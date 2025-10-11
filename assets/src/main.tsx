import React from 'react';
import { createRoot } from 'react-dom/client';
import FilesTableModern from './components/files-table-modern';
import { Header } from './components/layout/header';
import { Breadcrumb } from './components/layout/breadcrumb';
import './main.css';
import { decodeBase64 } from './utils';

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

interface PARAMS {
  q?: string;
  sort?: string;
  order?: string;
}

let DATA: DATA;

const PARAMS: PARAMS = Object.fromEntries(
  new URLSearchParams(window.location.search).entries(),
);

const IFRAME_FORMATS = [
  ".pdf",
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".bmp",
  ".svg",
  ".mp4",
  ".mov",
  ".avi",
  ".wmv",
  ".flv",
  ".webm",
  ".mp3",
  ".ogg",
  ".wav",
  ".m4a",
];

/**
 * Component registry for React components
 */
const componentRegistry = new Map<string, React.ComponentType<any>>();

/**
 * Register a React component for mounting
 */
function registerComponent(name: string, component: React.ComponentType<any>) {
  componentRegistry.set(name, component);
}

// Register React components
registerComponent("FilesTable", FilesTableModern);
registerComponent("Header", Header);
registerComponent("Breadcrumb", Breadcrumb);

/**
 * Mount React components to elements with data-react-component attribute
 */
async function mountReactComponents() {
  const elements = document.querySelectorAll("[data-react-component]");

  for (const element of elements) {
    const componentName = element.getAttribute("data-react-component");

    if (componentName && componentRegistry.has(componentName)) {
      const Component = componentRegistry.get(componentName)!;
      const root = createRoot(element);

      // Provide appropriate props based on component type
      if (componentName === "Header") {
        root.render(
          <Component
            auth={DATA.auth}
            user={DATA.user}
            allowUpload={DATA.allow_upload}
            allowSearch={DATA.allow_search}
            onSearch={(query: string) => {
              const href = baseUrl();
              location.href = query ? `${href}?q=${query}` : href;
            }}
            onLogin={async () => {
              try {
                await checkAuth("login");
              } catch { }
              location.reload();
            }}
            onLogout={logout}
            onNewFolder={() => {
              const name = prompt("Enter folder name");
              if (name) createFolder(name);
            }}
            onNewFile={() => {
              const name = prompt("Enter file name");
              if (name) createFile(name);
            }}
          />
        );
      } else if (componentName === "Breadcrumb") {
        root.render(<Component href={DATA.href} uriPrefix={DATA.uri_prefix} />);
      } else {
        root.render(<Component DATA={DATA} />);
      }
    } else {
      console.warn(`Component '${componentName}' not found in registry`);
    }
  }
}

/**
 * Initialize Uppy uploader
 */
async function initializeUppy() {
  if (!DATA.allow_upload) {
    return;
  }

  const uppyContainer = document.getElementById("uppy-container");
  if (!uppyContainer) {
    return;
  }

  // Dynamically import Uppy modules
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { Uppy, Dashboard, XHRUpload } = await import(
    "https://releases.transloadit.com/uppy/v5.1.5/uppy.min.mjs" as any
  );

  const uppy = new Uppy({
    autoProceed: false,
    restrictions: {
      maxNumberOfFiles: null,
    },
  })
    .use(Dashboard, {
      target: "#uppy-container",
      inline: true,
      height: 400,
      showProgressDetails: true,
      hideUploadButton: false,
      proudlyDisplayPoweredByUppy: false,
      note: "Upload files to create digital provenance records with Bitcoin timestamps",
    })
    .use(XHRUpload, {
      endpoint: (file: any) => {
        const currentPath = window.location.pathname;
        const fileName = encodeURIComponent(file.name);
        return `${currentPath}${currentPath.endsWith("/") ? "" : "/"}${fileName}`;
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
            url: window.location.pathname + encodeURIComponent(response.filename),
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
    });

  uppy.on("upload-success", (file: any, response: any) => {
    console.log("Upload successful:", file.name, response);
    setTimeout(() => {
      location.reload();
    }, 1000);
  });

  uppy.on("complete", (result: any) => {
    console.log("Upload complete:", result);
    if (result.successful.length > 0) {
      const emptyFolder = document.querySelector(".empty-folder");
      if (emptyFolder && !emptyFolder.classList.contains("hidden")) {
        emptyFolder.classList.add("hidden");
      }
    }
  });

  if (DATA.auth) {
    uppy.on("file-added", async () => {
      try {
        await checkAuth();
      } catch (err) {
        console.error("Authentication required:", err);
      }
    });
  }

  return uppy;
}

// Produce table when window loads
window.addEventListener("DOMContentLoaded", async () => {
  const $indexData = document.getElementById("index-data");
  if (!$indexData) {
    alert("No data");
    return;
  }

  DATA = JSON.parse(decodeBase64($indexData.innerHTML));

  await ready();

  // Mount React components after DOM is ready
  await mountReactComponents();

  // Initialize Uppy uploader
  await initializeUppy();
});

async function ready() {
  if (DATA.kind === "Index") {
    document.title = `Index of ${DATA.href} - Node Drive`;
    document.querySelector(".index-page")?.classList.remove("hidden");

    await setupIndexPage();
  } else if (DATA.kind === "Edit") {
    document.title = `Edit ${DATA.href} - Node Drive`;
    document.querySelector(".editor-page")?.classList.remove("hidden");

    await setupEditorPage();
  } else if (DATA.kind === "View") {
    document.title = `View ${DATA.href} - Node Drive`;
    document.querySelector(".editor-page")?.classList.remove("hidden");

    await setupEditorPage();
  }
}


async function setupIndexPage() {
  // Most UI is now handled by React components
  // Keep download token setup if needed
  if (DATA.user) {
    setupDownloadWithToken();
  }
}


function setupDownloadWithToken() {
  document.querySelectorAll<HTMLAnchorElement>("a.dlwt").forEach((link) => {
    link.addEventListener("click", async (e) => {
      e.preventDefault();
      try {
        const link = e.currentTarget as HTMLAnchorElement;
        const originalHref = link.getAttribute("href")!;
        const tokengenUrl = new URL(originalHref);
        tokengenUrl.searchParams.set("tokengen", "");
        const res = await fetch(tokengenUrl);
        if (!res.ok) throw new Error("Failed to fetch token");
        const token = await res.text();
        const downloadUrl = new URL(originalHref);
        downloadUrl.searchParams.set("token", token);
        const tempA = document.createElement("a");
        tempA.href = downloadUrl.toString();
        tempA.download = "";
        document.body.appendChild(tempA);
        tempA.click();
        document.body.removeChild(tempA);
      } catch (err) {
        alert(`Failed to download, ${(err as Error).message}`);
      }
    });
  });
}


async function setupEditorPage() {
  const url = baseUrl();

  const $download = document.querySelector<HTMLAnchorElement>(".download");
  if ($download) {
    $download.classList.remove("hidden");
    $download.href = url;
  }

  if (DATA.kind == "Edit") {
    const $moveFile = document.querySelector(".move-file");
    $moveFile?.classList.remove("hidden");
    $moveFile?.addEventListener("click", async () => {
      const query = location.href.slice(url.length);
      const newFileUrl = await doMovePath(url);
      if (newFileUrl) {
        location.href = newFileUrl + query;
      }
    });

    const $deleteFile = document.querySelector(".delete-file");
    $deleteFile?.classList.remove("hidden");
    $deleteFile?.addEventListener("click", async () => {
      const url = baseUrl();
      const name = baseName(url);
      await doDeletePath(name, url, () => {
        location.href = location.href.split("/").slice(0, -1).join("/");
      });
    });

    if (DATA.editable) {
      const $saveBtn = document.querySelector(".save-btn");
      $saveBtn?.classList.remove("hidden");
      $saveBtn?.addEventListener("click", saveChange);
    }
  } else if (DATA.kind == "View") {
    const $editor = document.querySelector<HTMLTextAreaElement>(".editor");
    if ($editor) {
      $editor.readOnly = true;
    }
  }

  if (!DATA.editable) {
    const $notEditable = document.querySelector(".not-editable");
    const url = baseUrl();
    const ext = extName(baseName(url));
    if (IFRAME_FORMATS.find((v) => v === ext)) {
      $notEditable?.insertAdjacentHTML(
        "afterend",
        `<iframe src="${url}" sandbox width="100%" height="${window.innerHeight - 100}px"></iframe>`,
      );
    } else {
      $notEditable?.classList.remove("hidden");
      if ($notEditable) {
        $notEditable.textContent =
          "Cannot edit because file is too large or binary.";
      }
    }
    return;
  }

  const $editor = document.querySelector<HTMLTextAreaElement>(".editor");
  if (!$editor) return;

  $editor.classList.remove("hidden");
  try {
    const res = await fetch(baseUrl());
    await assertResOK(res);
    const encoding = getEncoding(res.headers.get("content-type"));
    if (encoding === "utf-8") {
      $editor.value = await res.text();
    } else {
      const bytes = await res.arrayBuffer();
      const dataView = new DataView(bytes);
      const decoder = new TextDecoder(encoding);
      $editor.value = decoder.decode(dataView);
    }
  } catch (err) {
    alert(`Failed to get file, ${(err as Error).message}`);
  }
}

async function doMovePath(fileUrl: string) {
  const fileUrlObj = new URL(fileUrl);
  const prefix = DATA.uri_prefix.slice(0, -1);
  const filePath = decodeURIComponent(fileUrlObj.pathname.slice(prefix.length));

  let newPath = prompt("Enter new path", filePath);
  if (!newPath) return;
  if (!newPath.startsWith("/")) newPath = "/" + newPath;
  if (filePath === newPath) return;
  const newFileUrl =
    fileUrlObj.origin +
    prefix +
    newPath.split("/").map(encodeURIComponent).join("/");

  try {
    await checkAuth();
    const res1 = await fetch(newFileUrl, {
      method: "HEAD",
    });
    if (res1.status === 200) {
      if (!confirm("Override existing file?")) {
        return;
      }
    }
    const res2 = await fetch(fileUrl, {
      method: "MOVE",
      headers: {
        Destination: newFileUrl,
      },
    });
    await assertResOK(res2);
    return newFileUrl;
  } catch (err) {
    alert(`Cannot move \`${filePath}\` to \`${newPath}\`, ${(err as Error).message}`);
  }
}

async function saveChange() {
  const $editor = document.querySelector<HTMLTextAreaElement>(".editor");
  if (!$editor) return;

  try {
    await fetch(baseUrl(), {
      method: "PUT",
      body: $editor.value,
    });
    location.reload();
  } catch (err) {
    alert(`Failed to save file, ${(err as Error).message}`);
  }
}

async function checkAuth(variant?: string) {
  if (!DATA.auth) return;
  const qs = variant ? `?${variant}` : "";
  const res = await fetch(baseUrl() + qs, {
    method: "CHECKAUTH",
  });
  await assertResOK(res);
  const $loginBtn = document.querySelector(".login-btn");
  const $logoutBtn = document.querySelector(".logout-btn");
  const $userName = document.querySelector(".user-name");

  $loginBtn?.classList.add("hidden");
  $logoutBtn?.classList.remove("hidden");
  if ($userName) {
    $userName.textContent = await res.text();
  }
}

function logout() {
  if (!DATA.auth) return;
  const url = baseUrl();
  const xhr = new XMLHttpRequest();
  xhr.open("LOGOUT", url, true, DATA.user);
  xhr.onload = () => {
    location.href = url;
  };
  xhr.send();
}

async function createFolder(name: string) {
  const url = newUrl(name);
  try {
    await checkAuth();
    const res = await fetch(url, {
      method: "MKCOL",
    });
    await assertResOK(res);
    location.href = url;
  } catch (err) {
    alert(`Cannot create folder \`${name}\`, ${(err as Error).message}`);
  }
}

async function createFile(name: string) {
  const url = newUrl(name);
  try {
    await checkAuth();
    const res = await fetch(url, {
      method: "PUT",
      body: "",
    });
    await assertResOK(res);
    location.href = url + "?edit";
  } catch (err) {
    alert(`Cannot create file \`${name}\`, ${(err as Error).message}`);
  }
}

async function doDeletePath(name: string, url: string, callback: () => void) {
  if (!confirm(`Delete \`${name}\`?`)) return;

  try {
    const res = await fetch(url, {
      method: "DELETE",
    });
    await assertResOK(res);
    callback();
  } catch (err) {
    alert(`Cannot delete \`${name}\`, ${(err as Error).message}`);
  }
}

// Helper functions
function baseUrl(): string {
  return location.href.split(/[?#]/)[0];
}

function newUrl(name: string): string {
  let url = baseUrl();
  if (!url.endsWith("/")) url += "/";
  url += name.split("/").map(encodeURIComponent).join("/");
  return url;
}

function baseName(url: string): string {
  return decodeURIComponent(
    url
      .split("/")
      .filter((v) => v.length > 0)
      .slice(-1)[0]
  );
}

function extName(filename: string): string {
  const dotIndex = filename.lastIndexOf(".");

  if (dotIndex === -1 || dotIndex === 0 || dotIndex === filename.length - 1) {
    return "";
  }

  return filename.substring(dotIndex);
}

async function assertResOK(res: Response): Promise<void> {
  if (!(res.status >= 200 && res.status < 300)) {
    throw new Error((await res.text()) || `Invalid status ${res.status}`);
  }
}

function getEncoding(contentType: string | null): string {
  const charset = contentType?.split(";")[1];
  if (charset && /charset/i.test(charset)) {
    let encoding = charset.split("=")[1];
    if (encoding) {
      return encoding.toLowerCase();
    }
  }
  return "utf-8";
}
