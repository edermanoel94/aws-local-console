export function formatBytes(bytes: number | undefined | null): string {
  if (bytes === undefined || bytes === null || Number.isNaN(bytes)) return "-";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

/** Accepts ISO strings, epoch seconds (SQS/DynamoDB) or epoch milliseconds. */
export function toDate(value: unknown): Date | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "number" || (typeof value === "string" && /^\d+(\.\d+)?$/.test(value))) {
    const n = Number(value);
    return new Date(n < 1e12 ? n * 1000 : n);
  }
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d;
}

const DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

export function formatDateTime(value: unknown): string {
  const d = toDate(value);
  return d ? DATE_FORMAT.format(d) : "-";
}

/** Pretty prints JSON text when it parses, otherwise returns it unchanged. */
export function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

export function isJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

/** Formats seconds as a short human duration, e.g. 345600 -> "4 days". */
export function formatSeconds(value: unknown): string {
  const s = Number(value);
  if (!Number.isFinite(s)) return "-";
  if (s === 0) return "0 seconds";
  const units: [number, string][] = [
    [86400, "day"],
    [3600, "hour"],
    [60, "minute"],
  ];
  for (const [size, label] of units) {
    if (s % size === 0) {
      const n = s / size;
      return `${n} ${label}${n === 1 ? "" : "s"}`;
    }
  }
  return `${s} second${s === 1 ? "" : "s"}`;
}

export function plural(n: number, word: string, pluralWord = `${word}s`) {
  return `${n} ${n === 1 ? word : pluralWord}`;
}
