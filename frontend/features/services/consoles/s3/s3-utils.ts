import type { Exec } from "../_shared/aws";
import type { GetObjectOutput, ListObjectVersionsOutput } from "./s3-types";

/** Deletes every object version and delete marker of a bucket. Returns the number of deleted entries. */
export async function emptyBucket(exec: Exec, bucket: string): Promise<number> {
  let deleted = 0;
  for (let round = 0; round < 50; round++) {
    const out = await exec<ListObjectVersionsOutput>("s3", "ListObjectVersions", { Bucket: bucket, MaxKeys: 1000 });
    const entries = [...(out.Versions ?? []), ...(out.DeleteMarkers ?? [])].map((v) => ({
      Key: v.Key,
      ...(v.VersionId && v.VersionId !== "null" ? { VersionId: v.VersionId } : {}),
    }));
    if (entries.length === 0) break;
    await exec("s3", "DeleteObjects", { Bucket: bucket, Delete: { Objects: entries, Quiet: true } });
    deleted += entries.length;
  }
  return deleted;
}

/** GetObject body (UTF-8 string or {base64}) -> Blob. */
export function bodyToBlob(body: GetObjectOutput["Body"], contentType?: string): Blob {
  const type = contentType || "application/octet-stream";
  if (body === undefined || body === null) return new Blob([], { type });
  if (typeof body === "string") return new Blob([body], { type });
  const binary = atob(body.base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}

/** Triggers a browser download of a Blob. */
export function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Reads a File as either UTF-8 text (when it decodes cleanly) or base64. */
export async function readFileForUpload(file: File): Promise<{ text: string } | { base64: string }> {
  const buffer = new Uint8Array(await file.arrayBuffer());
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(buffer) };
  } catch {
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < buffer.length; i += chunk) binary += String.fromCharCode(...buffer.subarray(i, i + chunk));
    return { base64: btoa(binary) };
  }
}

export function baseName(key: string) {
  const trimmed = key.endsWith("/") ? key.slice(0, -1) : key;
  return trimmed.split("/").pop() || trimmed;
}

export const EVENT_TYPES = [
  { value: "s3:ObjectCreated:*", label: "All object create events" },
  { value: "s3:ObjectCreated:Put", label: "Put" },
  { value: "s3:ObjectCreated:Copy", label: "Copy" },
  { value: "s3:ObjectRemoved:*", label: "All object removal events" },
  { value: "s3:ObjectRemoved:Delete", label: "Permanently deleted" },
  { value: "s3:ObjectRemoved:DeleteMarkerCreated", label: "Delete marker created" },
];
