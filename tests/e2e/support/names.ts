const runId = (process.env.TEST_RUN_ID ?? Date.now().toString(36)).toLowerCase();

/** Unique, DNS-compatible resource name for test isolation (CONTRACT section 7). */
export function uniqueName(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 7);
  return `${prefix}-${runId}-${random}`.toLowerCase().slice(0, 63);
}
