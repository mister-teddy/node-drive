/**
 * Trigger download of a file with given filename and byte content
 */
export function download(filename: string, bytes: BlobPart): void {
  const blob = new Blob([bytes], { type: "octet/stream" });
  const link = document.createElement("a");
  link.href = window.URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export function baseName(url: string): string {
  return decodeURIComponent(
    url
      .split("/")
      .filter((v) => v.length > 0)
      .slice(-1)[0]
  );
}

export function extName(filename: string): string {
  const dotIndex = filename.lastIndexOf(".");

  if (dotIndex === -1 || dotIndex === 0 || dotIndex === filename.length - 1) {
    return "";
  }

  return filename.substring(dotIndex);
}

export function getEncoding(contentType: string | null): string {
  const charset = contentType?.split(";")[1];
  if (charset && /charset/i.test(charset)) {
    let encoding = charset.split("=")[1];
    if (encoding) {
      return encoding.toLowerCase();
    }
  }
  return "utf-8";
}
