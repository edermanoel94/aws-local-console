"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { executeOrThrow } from "@/lib/api";
import { toast } from "@/stores/toast";
import { useRegion } from "./use-region";

interface Options<TVars> {
  service: string;
  operation: string;
  /** Builds the AWS input from the mutation variables. */
  input: (vars: TVars) => Record<string, unknown>;
  /** Success toast text (role="status"), e.g. (v) => `Bucket ${v.name} created`. */
  successMessage?: (vars: TVars) => string;
  /** Query key prefixes to invalidate on success. Resources/logs/events/dashboard are always invalidated. */
  invalidate?: unknown[][];
}

/**
 * Runs one AWS operation from a service console through the Go API (source "console").
 * Errors are OperationError/ApiError; render them with <ErrorAlert error={mutation.error} />.
 */
export function useAwsOperation<TVars = void, TOutput = unknown>(opts: Options<TVars>) {
  const region = useRegion();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: TVars) => {
      const { output } = await executeOrThrow<TOutput>({ service: opts.service, operation: opts.operation, region, input: opts.input(vars) });
      return output;
    },
    onSuccess: (_out, vars) => {
      if (opts.successMessage) toast.success(opts.successMessage(vars));
      for (const key of [...(opts.invalidate ?? []), ["resources"], ["logs"], ["events"], ["dashboard"], ["architecture"]]) {
        qc.invalidateQueries({ queryKey: key });
      }
    },
  });
}
