import type { ErrorKind } from "@/types/api";
import { ApiError, OperationError } from "@/lib/api";

export interface DisplayError {
  title: string;
  code: string;
  message: string;
  kind: ErrorKind | "api";
}

const TITLES: Record<DisplayError["kind"], string> = {
  aws: "AWS Error",
  unsupported: "Floci Unsupported Operation",
  validation: "Validation Error",
  network: "Network Error",
  application: "Application Error",
  api: "Application Error",
};

/** Normalizes any thrown value into something the ErrorAlert can render (see CONTRACT section 6). */
export function toDisplayError(err: unknown): DisplayError {
  if (err instanceof OperationError && err.result.error) {
    const { kind, code, message } = err.result.error;
    return { title: TITLES[kind], code, message, kind };
  }
  if (err instanceof ApiError) {
    // 400/404 from the Go API are request validation problems (unknown service/operation, malformed input).
    const kind = err.status === 0 ? "network" : err.status === 400 || err.status === 404 ? "validation" : "api";
    return { title: TITLES[kind], code: err.code, message: err.message, kind };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { title: TITLES.application, code: "Error", message, kind: "application" };
}
