"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type UseQueryOptions } from "@tanstack/react-query";
import { executeOrThrow } from "@/lib/api";
import { useRegion } from "@/hooks/use-region";
import { toast } from "@/stores/toast";

/** Floci's fixed account id (CONTRACT section 1). */
export const ACCOUNT_ID = "000000000000";

/** Root query key of every service console query; mutations invalidate it as a whole. */
export const CONSOLE_KEY = "console";

type Input = Record<string, unknown>;

/** Executes one AWS operation for the console and returns its output (throws OperationError on AWS errors). */
export type Exec = <T = unknown>(service: string, operation: string, input?: Input, options?: { region?: string }) => Promise<T>;

export function makeExec(region: string): Exec {
  return async <T,>(service: string, operation: string, input: Input = {}, options?: { region?: string }) => {
    const { output } = await executeOrThrow<T>({ service, operation, region: options?.region ?? region, input });
    return output;
  };
}

/** Read query against the operation engine, keyed by service/operation/region/input. */
export function useAwsQuery<T = unknown>(
  service: string,
  operation: string,
  input: Input = {},
  options?: Omit<UseQueryOptions<T>, "queryKey" | "queryFn">,
) {
  const region = useRegion();
  return useQuery<T>({
    queryKey: [CONSOLE_KEY, service, region, operation, input],
    queryFn: () => makeExec(region)<T>(service, operation, input),
    ...options,
  });
}

/**
 * Paginated read loaded page by page on demand ("Load more"), keyed like useAwsQuery.
 * `next` extracts the continuation token from a page and `tokenField` is the input member that carries it.
 * `restart()` drops the loaded pages and fetches the first one again.
 */
export function useAwsPagedQuery<T, Token>(
  service: string,
  operation: string,
  input: Input,
  pagination: { next: (page: T) => Token | null | undefined; tokenField: string },
) {
  const region = useRegion();
  const qc = useQueryClient();
  const queryKey = [CONSOLE_KEY, service, region, operation, input, "pages"];
  const query = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) => makeExec(region)<T>(service, operation, pageParam === undefined ? input : { ...input, [pagination.tokenField]: pageParam }),
    initialPageParam: undefined as Token | undefined,
    getNextPageParam: (page) => pagination.next(page) ?? undefined,
  });
  return { ...query, restart: () => qc.resetQueries({ queryKey, exact: true }) };
}

/** Arbitrary async read built from several operations (e.g. list + describe each). */
export function useAwsLoader<T>(key: unknown[], load: (exec: Exec) => Promise<T>, options?: Omit<UseQueryOptions<T>, "queryKey" | "queryFn">) {
  const region = useRegion();
  return useQuery<T>({
    queryKey: [CONSOLE_KEY, ...key, region],
    queryFn: () => load(makeExec(region)),
    ...options,
  });
}

interface ActionOptions<TVars, TResult> {
  run: (vars: TVars, exec: Exec) => Promise<TResult>;
  /** Success toast (role="status"). */
  successMessage?: (vars: TVars, result: TResult) => string;
  onSuccess?: (result: TResult, vars: TVars) => void;
}

/**
 * Console mutation made of one or more operations (source "console").
 * On success it toasts and invalidates every console query plus the global views (resources, logs, events, ...).
 */
export function useConsoleAction<TVars = void, TResult = unknown>(opts: ActionOptions<TVars, TResult>) {
  const region = useRegion();
  const qc = useQueryClient();
  return useMutation<TResult, Error, TVars>({
    mutationFn: (vars) => opts.run(vars, makeExec(region)),
    onSuccess: async (result, vars) => {
      if (opts.successMessage) toast.success(opts.successMessage(vars, result));
      opts.onSuccess?.(result, vars);
      for (const key of [[CONSOLE_KEY], ["resources"], ["logs"], ["events"], ["dashboard"], ["architecture"]]) {
        await qc.invalidateQueries({ queryKey: key });
      }
    },
  });
}

/** Last segment of an ARN (after ":" or "/"). */
export function nameFromArn(arn: string): string {
  const tail = arn.split(":").pop() ?? arn;
  return tail.split("/").pop() ?? tail;
}

/**
 * Display name of an event source ARN: the table of a DynamoDB stream
 * (arn:aws:dynamodb:r:a:table/orders/stream/2026-01-01T00:00:00.000 -> orders), else the last ARN segment.
 */
export function eventSourceName(arn: string): string {
  const stream = /^arn:aws:dynamodb:[^:]*:[^:]*:table\/([^/]+)\/stream\//.exec(arn);
  return stream ? stream[1] : nameFromArn(arn);
}

/** SQS queue URL -> queue name. */
export function queueNameFromUrl(url: string): string {
  return url.split("/").pop() ?? url;
}

export function sqsArn(region: string, name: string) {
  return `arn:aws:sqs:${region}:${ACCOUNT_ID}:${name}`;
}

/** Sleeps for `ms` milliseconds (used for short polling of asynchronous results such as logs). */
export function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
