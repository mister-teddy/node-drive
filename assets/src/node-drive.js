// @ts-check
import { makeAutoObservable } from "./esm-imports.js";
import { calculateSHA256, newUrl, formatFileSize, formatPercent, formatDuration, stamp } from "./utils.js";

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


export class Uploader {
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

        // Grouped text properties
        this.text = {
            progress: "",
            speed: "",
            duration: ""
        };

        // Grouped timestamp properties
        /** @type {{ status: string, bytes: Uint8Array | null, created: Date | null, error: string | null, bitcoinBlock: any, bitcoinConfirmed: any }} */
        this.timestamp = {
            status: "none", // "none", "creating", "pending", "confirmed", "failed"
            bytes: null,
            created: null,
            error: null,
            bitcoinBlock: null,
            bitcoinConfirmed: null,
        };

        // SHA256 hash (computed after hashing)
        this.sha256 = "";

        // Make this instance observable
        makeAutoObservable(this);

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
        return this.status === "complete" && this.timestamp.status === "pending" && !!this.timestamp.bytes;
    }

    /**
     * Get human-readable timestamp status
     * @returns {string}
     */
    getTimestampStatusText() {
        switch (this.timestamp.status) {
            case "creating":
                return "Creating timestamp proof...";
            case "pending":
                return "Waiting for Bitcoin confirmation";
            case "confirmed":
                return "Verified on Bitcoin blockchain";
            case "failed":
                return this.timestamp.error || "Timestamp creation failed";
            default:
                return "No timestamp";
        }
    }

    // MobX Actions
    /**
     * @param {number} loaded
     * @param {number} percent
     * @param {string} progressText
     * @param {string} speedText
     * @param {string} duration
     */
    updateProgress(loaded, percent, progressText, speedText, duration) {
        this.uploaded = loaded;
        this.status = "uploading";
        this.statusReason = "";
        this.progressValue = percent;
        this.text.progress = progressText;
        this.text.speed = speedText;
        this.text.duration = duration;
    }

    setComplete() {
        this.status = "complete";
        this.statusReason = "";
        this.progressValue = 100;
        this.text.progress = "100%";
        this.text.speed = "";
        this.text.duration = "";
    }

    /**
     * @param {string} reason
     */
    setFailed(reason) {
        this.status = "failed";
        this.statusReason = reason;
        this.progressValue = 0;
        this.text.progress = "";
        this.text.speed = "";
        this.text.duration = "";
    }

    /**
     * @param {string} status
     * @param {Uint8Array<ArrayBufferLike> | null} bytes
     * @param {Date | null} created
     * @param {null|string} error
     */
    updateTimestampStatus(status, bytes, created, error) {
        this.timestamp.status = status;
        this.timestamp.bytes = bytes;
        this.timestamp.created = created;
        this.timestamp.error = error;
    }

    setInitialStatus() {
        this.status = "pending";
        this.statusReason = "";
        this.progressValue = 0;
        this.text.progress = "";
        this.text.speed = "";
        this.text.duration = "";
    }

    setUploading() {
        this.status = "uploading";
        this.statusReason = "";
        this.progressValue = 0;
        this.text.progress = "";
        this.text.speed = "";
        this.text.duration = "";
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
        if (this.isUploading && this.text.progress) {
            return `${this.text.progress} • ${this.text.speed}`;
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
