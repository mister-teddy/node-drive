// @ts-check
import { makeAutoObservable } from "./esm-imports.js";
import { calculateSHA256, newUrl, formatFileSize, formatPercent, formatDuration, hexToBytes, download } from "./utils.js";


/**
 * Create OpenTimestamps proof for a file hash
 * @param {string} filename - Name of the file
 * @param {string} hash - SHA256 hash of the file
 * @returns {Promise<{filename: string, timestampBytes: BodyInit} | null>}
 */
export async function stamp(filename, hash) {
    try {
        // @ts-ignore
        const { OpenTimestamps } = window;

        if (!OpenTimestamps) {
            console.warn("OpenTimestamps library not loaded");
            return null;
        }

        const op = new OpenTimestamps.Ops.OpSHA256();
        const detached = OpenTimestamps.DetachedTimestampFile.fromHash(op, hexToBytes(hash));

        // Create the timestamp
        await OpenTimestamps.stamp(detached);

        // Serialize the timestamp
        const ctx = new OpenTimestamps.Context.StreamSerialization();
        detached.serialize(ctx);
        const timestampBytes = ctx.getOutput();

        const extractedFileExtension = filename.match(/\.[0-9a-z]+$/i);
        const isOtsExt = extractedFileExtension !== null && extractedFileExtension.length > 0 && extractedFileExtension[0] === ".ots";
        const otsFilename = filename + (isOtsExt ? '' : '.ots')

        download(otsFilename, timestampBytes);

        return { filename, timestampBytes };
    } catch (error) {
        console.error("OpenTimestamps stamping error:", error);
        return null;
    }
}


/**
 * Check if OTS proof is still pending (placeholder)
 * @param {{ detachedOts: any, detached: any }} param0
 * @returns {Promise<'pending-attestation' | 'cannot-verify' | 'unknown-attestation-type' | Object>}
 */
export async function getStampStatus({ detachedOts, detached }) {
    try {

        // @ts-ignore
        const { OpenTimestamps } = window;

        // OpenTimestamps upgrade command
        // OpenTimestamps.upgrade(detachedOts).then( (changed)=>{
        //     const bytes = detachedOts.serializeToBytes();
        // 	if(changed){
        //     	//success('Timestamp has been successfully upgraded!');
        //         filename = filename || hash + ".ots";
        //     	download(filename, bytes);

        //     	// update proof
        //     	Proof.data = bin2String(bytes);
        // 	} else {
        //     	// File not changed: just upgraded
        // 	}
        // 	return OpenTimestamps.verify(detachedOts,detached)

        const results = await OpenTimestamps.verify(detachedOts, detached)
        if (Object.keys(results).length == 0) {
            // no attestation returned
            if (detachedOts.timestamp.isTimestampComplete()) {
                // check attestations
                detachedOts.timestamp.allAttestations().forEach((/** @type {any} */ attestation) => {
                    if (attestation instanceof OpenTimestamps.Notary.UnknownAttestation) {
                        return 'unknown-attestation-type';
                    }
                });
            } else {
                return 'pending-attestation';
            }
        }
        return results;
    } catch (error) {
        return 'cannot-verify';
    }
};

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
        /** @type {{ status: string, bytes: BodyInit | null, created: Date | null, error: string | null, bitcoinBlock: any, bitcoinConfirmed: any }} */
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
        // Check for secure context (HTTPS required for crypto.subtle)
        if (!window.isSecureContext) {
            this.setFailed("HTTPS required for provenance features");
            showInsecureContextWarning();
            return;
        }

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

    /**
     * Upload OTS proof to server after file upload completes
     */
    async uploadOtsProof() {
        if (!this.timestamp.bytes) {
            console.warn("No OTS timestamp bytes to upload");
            return;
        }

        try {
            const otsUrl = this.url + "?ots";
            const response = await fetch(otsUrl, {
                method: "POST",
                body: this.timestamp.bytes,
            });

            if (response.ok) {
                console.log("OTS proof uploaded successfully");
            } else {
                console.warn("Failed to upload OTS proof:", response.statusText);
            }
        } catch (error) {
            console.error("Error uploading OTS proof:", error);
        }
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

        // Upload OTS proof to server after file upload completes
        this.uploadOtsProof();
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
     * @param {BodyInit | null} bytes
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

/**
 * Show warning modal when user attempts upload in non-secure context
 */
function showInsecureContextWarning() {
    // Check if modal already exists
    if (document.getElementById('insecure-context-modal')) {
        return;
    }

    // Create modal overlay
    const modal = document.createElement('div');
    modal.id = 'insecure-context-modal';
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background-color: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
        padding: 20px;
    `;

    // Create modal content
    const modalContent = document.createElement('div');
    modalContent.style.cssText = `
        background-color: #fff;
        border-radius: 8px;
        padding: 24px;
        max-width: 500px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    `;

    // Create modal HTML
    modalContent.innerHTML = `
        <div style="margin-bottom: 16px;">
            <h3 style="margin: 0 0 12px 0; color: #d32f2f; font-size: 18px;">
                ⚠️ Secure Context Required
            </h3>
            <p style="margin: 0 0 12px 0; color: #333; font-size: 14px; line-height: 1.5;">
                File provenance features require a secure context (HTTPS) to work properly.
                The <code>crypto.subtle</code> API used for file hashing is only available over HTTPS.
            </p>
            <p style="margin: 0 0 16px 0; color: #666; font-size: 13px; line-height: 1.5;">
                Please switch to the HTTPS version of this site to upload files with cryptographic provenance.
            </p>
        </div>
        <div style="display: flex; gap: 12px; justify-content: flex-end;">
            <button id="insecure-modal-close" style="
                padding: 8px 16px;
                background: #f5f5f5;
                border: 1px solid #ddd;
                border-radius: 4px;
                cursor: pointer;
                font-size: 14px;
                color: #333;
            ">Cancel</button>
            <button id="insecure-modal-redirect" style="
                padding: 8px 16px;
                background: #2196F3;
                border: none;
                border-radius: 4px;
                cursor: pointer;
                font-size: 14px;
                color: white;
                font-weight: 500;
            ">Switch to HTTPS</button>
        </div>
    `;

    modal.appendChild(modalContent);
    document.body.appendChild(modal);

    // Add event listeners
    const closeBtn = document.getElementById('insecure-modal-close');
    const redirectBtn = document.getElementById('insecure-modal-redirect');

    const closeModal = () => {
        modal.remove();
    };

    closeBtn?.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            closeModal();
        }
    });

    redirectBtn?.addEventListener('click', () => {
        const httpsUrl = window.location.href.replace(/^http:/, 'https:');
        window.location.href = httpsUrl;
    });
}

Object.assign(window, { Uploader });
