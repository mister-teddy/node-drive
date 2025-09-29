// @ts-check
// @ts-ignore
import { createElement } from "https://esm.sh/react@18.3.1";
// @ts-ignore
import { makeObservable, observable, action, computed } from "https://esm.sh/mobx@6.15.0";
import { store, calculateSHA256, newUrl, formatFileSize, formatPercent, formatDuration, stamp } from "../utils.js";

/**
 * @typedef {Object} DATA
 * @property {boolean} allow_upload
 */

/**
 * @type {Map<number, Uploader>}
 */
const failUploaders = new Map();

/**
 * @type {number}
 */
const DUFS_MAX_UPLOADINGS = 1;

/**
 * @returns {Promise<void>}
 */
async function checkAuth() {
  // Placeholder implementation - this should match the checkAuth from index.js
  return Promise.resolve();
}

/**
 * @param {{ DATA: DATA }} props
 */
export default function UploadButton({ DATA }) {
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
      onChange: async (/** @type {Event} */ e) => {
        const files = /** @type {HTMLInputElement} */ (e.target).files;
        if (!files) return;
        for (let file of files) {
          const uploader = new Uploader(file, []);
          store.uploadQueue = [
            ...store.uploadQueue,
            uploader
          ];
          await uploader.upload();
        }
      },
    }),
  );
}


class Uploader {
  /**
   * @param {File} file
   * @param {string[]} pathParts
   */
  constructor(file, pathParts) {
    this.uploaded = 0;
    this.uploadOffset = 0;
    this.lastUptime = 0;
    this.name = [...pathParts, file.name].join("/");
    this.idx = Uploader.globalIdx++;
    this.file = file;
    this.url = newUrl(this.name);

    // New: status state variables
    this.status = "pending"; // "pending", "uploading", "complete", "failed"
    this.statusReason = "";
    this.progressValue = 0;
    this.progressText = "";
    this.speedText = "";
    this.durationText = "";

    // OpenTimestamps properties
    this.timestampStatus = "none"; // "none", "creating", "pending", "confirmed", "failed"
    this.timestampBytes = null;
    this.timestampCreated = null;
    this.timestampError = null;
    this.bitcoinBlock = null;
    this.bitcoinConfirmed = null;

    // SHA256 hash (computed after hashing)
    this.sha256 = "";

    // Make this instance observable
    makeObservable(this, {
      // Observable state
      uploaded: observable,
      status: observable,
      statusReason: observable,
      progressValue: observable,
      progressText: observable,
      speedText: observable,
      durationText: observable,
      timestampStatus: observable,
      timestampBytes: observable,
      timestampCreated: observable,
      timestampError: observable,
      bitcoinBlock: observable,
      bitcoinConfirmed: observable,
      sha256: observable,

      // Actions that modify state
      updateProgress: action,
      setComplete: action,
      setFailed: action,
      updateTimestampStatus: action,
      setInitialStatus: action,
      setUploading: action,

      // Computed properties
      isComplete: computed,
      isUploading: computed,
      isFailed: computed,
      displayProgress: computed
    });

    this.upload();
  }

  async upload() {
    // SHA256 hash calculation
    this.sha256 = await calculateSHA256(this.file, (/** @type {number} */ progress) => {
      console.log(`Progress: ${progress}%`);
    });

    // Stamp it with OpenTimestamps
    try {
      this.updateTimestampStatus("creating", null, null, null);
      const timestampResult = await stamp(this.name, this.sha256);
      if (timestampResult && timestampResult.timestampBytes) {
        this.updateTimestampStatus("pending", timestampResult.timestampBytes, new Date(), null);
      } else {
        this.updateTimestampStatus("failed", null, null, null);
      }
    } catch (/** @type {any} */ error) {
      console.warn("OpenTimestamps stamping failed:", error);
      this.updateTimestampStatus("failed", null, null, error?.message || "Unknown error");
    }


    // Set initial status using action
    this.setInitialStatus();
    Uploader.queues.push(this);
    Uploader.runQueue();
    return this;
  }

  ajax() {
    const { url } = this;

    this.uploaded = 0;
    this.lastUptime = Date.now();

    this.setUploading();

    const ajax = new XMLHttpRequest();
    ajax.upload.addEventListener("progress", (e) => this.progress(e), false);
    ajax.addEventListener("readystatechange", () => {
      if (ajax.readyState === 4) {
        if (ajax.status >= 200 && ajax.status < 300) {
          this.complete();
        } else {
          if (ajax.status != 0) {
            this.fail(`${ajax.status} ${ajax.statusText}`);
          }
        }
      }
    });
    ajax.addEventListener("error", () => this.fail(), false);
    ajax.addEventListener("abort", () => this.fail(), false);
    if (this.uploadOffset > 0) {
      ajax.open("PATCH", url);
      ajax.setRequestHeader("X-Update-Range", "append");
      ajax.send(this.file.slice(this.uploadOffset));
    } else {
      ajax.open("PUT", url);
      ajax.send(this.file);
      // setTimeout(() => ajax.abort(), 3000);
    }
  }

  async retry() {
    const { url } = this;
    let res = await fetch(url, {
      method: "HEAD",
    });
    let uploadOffset = 0;
    if (res.status == 200) {
      let value = res.headers.get("content-length");
      uploadOffset = parseInt(value || "0") || 0;
    }
    this.uploadOffset = uploadOffset;
    this.ajax();
  }

  /**
   * @param {ProgressEvent} event
   */
  progress(event) {
    const now = Date.now();
    const speed =
      ((event.loaded - this.uploaded) / (now - this.lastUptime)) * 1000;
    const [speedValue, speedUnit] = formatFileSize(speed);
    const speedText = `${speedValue} ${speedUnit}/s`;
    const percent = ((event.loaded + this.uploadOffset) / this.file.size) * 100;
    const progress = formatPercent(percent);
    const duration = formatDuration((event.total - event.loaded) / speed);

    // Use action to update state
    this.updateProgress(event.loaded, percent, progress, speedText, duration);

    this.lastUptime = now;
  }

  complete() {
    // Use action to update status
    this.setComplete();
    failUploaders.delete(this.idx);
    Uploader.runnings--;
    Uploader.runQueue();
  }

  /**
   * @param {string} reason
   */
  fail(reason = "") {
    // Use action to update status
    this.setFailed(reason);

    failUploaders.set(this.idx, this);
    Uploader.runnings--;
    Uploader.runQueue();
  }

  /**
   * Check if timestamp has been confirmed on Bitcoin blockchain
   * In a real implementation, this would query the OpenTimestamps servers
   * @returns {boolean}
   */
  isTimestampConfirmed() {
    // For demo purposes, simulate confirmation after upload is complete
    // In production, this would check actual OpenTimestamps verification
    return this.status === "complete" && this.timestampStatus === "pending" && !!this.timestampBytes;
  }

  /**
   * Get human-readable timestamp status
   * @returns {string}
   */
  getTimestampStatusText() {
    switch (this.timestampStatus) {
      case "creating":
        return "Creating timestamp proof...";
      case "pending":
        return "Waiting for Bitcoin confirmation";
      case "confirmed":
        return "Verified on Bitcoin blockchain";
      case "failed":
        return this.timestampError || "Timestamp creation failed";
      default:
        return "No timestamp";
    }
  }

  // MobX Actions
  updateProgress(loaded, percent, progressText, speedText, duration) {
    this.uploaded = loaded;
    this.status = "uploading";
    this.statusReason = "";
    this.progressValue = percent;
    this.progressText = progressText;
    this.speedText = speedText;
    this.durationText = duration;
  }

  setComplete() {
    this.status = "complete";
    this.statusReason = "";
    this.progressValue = 100;
    this.progressText = "100%";
    this.speedText = "";
    this.durationText = "";
  }

  setFailed(reason) {
    this.status = "failed";
    this.statusReason = reason;
    this.progressValue = 0;
    this.progressText = "";
    this.speedText = "";
    this.durationText = "";
  }

  updateTimestampStatus(status, bytes, created, error) {
    this.timestampStatus = status;
    this.timestampBytes = bytes;
    this.timestampCreated = created;
    this.timestampError = error;
  }

  setInitialStatus() {
    this.status = "pending";
    this.statusReason = "";
    this.progressValue = 0;
    this.progressText = "";
    this.speedText = "";
    this.durationText = "";
  }

  setUploading() {
    this.status = "uploading";
    this.statusReason = "";
    this.progressValue = 0;
    this.progressText = "";
    this.speedText = "";
    this.durationText = "";
  }

  // MobX Computed Properties
  get isComplete() {
    return this.status === "complete";
  }

  get isUploading() {
    return this.status === "uploading";
  }

  get isFailed() {
    return this.status === "failed";
  }

  get displayProgress() {
    if (this.isUploading && this.progressText) {
      return `${this.progressText} • ${this.speedText}`;
    }
    if (this.isFailed && this.statusReason) {
      return `Failed: ${this.statusReason}`;
    }
    return this.status;
  }
}

Uploader.globalIdx = 0;

Uploader.runnings = 0;

Uploader.auth = false;

/**
 * @type Uploader[]
 */
Uploader.queues = [];

Uploader.runQueue = async () => {
  if (Uploader.runnings >= DUFS_MAX_UPLOADINGS) return;
  if (Uploader.queues.length == 0) return;
  Uploader.runnings++;
  let uploader = Uploader.queues.shift();
  if (!uploader) return;
  if (!Uploader.auth) {
    Uploader.auth = true;
    try {
      await checkAuth();
    } catch {
      Uploader.auth = false;
    }
  }
  uploader.ajax();
};

Object.assign(window, { Uploader });
