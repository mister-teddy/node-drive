export function formatMtime(mtime: number): string {
  if (!mtime) return "";
  const date = new Date(mtime);
  const year = date.getFullYear();
  const month = padZero(date.getMonth() + 1, 2);
  const day = padZero(date.getDate(), 2);
  const hours = padZero(date.getHours(), 2);
  const minutes = padZero(date.getMinutes(), 2);
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

export function padZero(value: number, size: number): string {
  return ("0".repeat(size) + value).slice(-1 * size);
}

export function formatDirSize(size: number): string {
  const MAX_SUBPATHS_COUNT = 1000;
  const unit = size === 1 ? "item" : "items";
  const num =
    size >= MAX_SUBPATHS_COUNT ? `>${MAX_SUBPATHS_COUNT - 1}` : `${size}`;
  return ` ${num} ${unit}`;
}

export function formatFileSize(size: number): [number, string] {
  if (size == null) return [0, "B"];
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  if (size == 0) return [0, "B"];
  const i = Math.floor(Math.log(size) / Math.log(1024));
  let ratio = 1;
  if (i >= 3) {
    ratio = 100;
  }
  return [
    Math.round(((size * ratio) / Math.pow(1024, i)) * 100) / 100 / ratio,
    sizes[i],
  ];
}

export function formatDuration(seconds: number): string {
  seconds = Math.ceil(seconds);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds - h * 3600) / 60);
  const s = seconds - h * 3600 - m * 60;
  return `${padZero(h, 2)}:${padZero(m, 2)}:${padZero(s, 2)}`;
}

export function formatPercent(percent: number): string {
  if (percent > 10) {
    return percent.toFixed(1) + "%";
  } else {
    return percent.toFixed(2) + "%";
  }
}
