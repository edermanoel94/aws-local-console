import type { Exec } from "./aws";

interface PaginationOptions<TOut, TItem> {
  /** Items of one page. */
  items: (out: TOut) => TItem[] | null | undefined;
  /** Token of the next page (absent/empty on the last page). */
  next: (out: TOut) => string | null | undefined;
  /** Input member that carries the token (e.g. "NextToken", "ExclusiveStartTableName"). */
  tokenField: string;
  /** Safety bound against a misbehaving endpoint that never stops paginating. */
  maxPages?: number;
}

/** Runs a list operation page by page and returns every item, so lists stay complete past the first page (100 topics, tables, rules, ...). */
export async function listAllPages<TOut, TItem>(exec: Exec, service: string, operation: string, input: Record<string, unknown>, options: PaginationOptions<TOut, TItem>): Promise<TItem[]> {
  const all: TItem[] = [];
  let token: string | null | undefined;
  for (let page = 0; page < (options.maxPages ?? 50); page++) {
    const out = await exec<TOut>(service, operation, token ? { ...input, [options.tokenField]: token } : input);
    all.push(...(options.items(out) ?? []));
    token = options.next(out);
    if (!token) break;
  }
  return all;
}
