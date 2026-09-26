"use client";

import { useState } from "react";
import { Info } from "lucide-react";
import { Button, ErrorAlert, Panel } from "@/components/ui";
import { useRegion } from "@/hooks/use-region";
import { useConsoleAction } from "../_shared/aws";
import { CodeField } from "../_shared/controls";
import type { FunctionConfiguration } from "./lambda-types";
import { codeFileName, defaultCode, recallCode, rememberCode, runtimeFamily } from "./runtimes";

export function CodeTab({ fn }: { fn: FunctionConfiguration }) {
  const region = useRegion();
  const runtime = fn.Runtime ?? "nodejs22.x";
  const handler = fn.Handler ?? "index.handler";
  const [stored, setStored] = useState(() => recallCode(region, fn.FunctionName));
  const known = stored && stored.sha === fn.CodeSha256 ? stored : null;
  const [code, setCode] = useState(known?.code ?? defaultCode(runtime));
  const fileName = known?.fileName ?? codeFileName(handler, runtime);
  const editable = runtimeFamily(runtime) !== null;

  const deploy = useConsoleAction<string, FunctionConfiguration>({
    run: (source, exec) => exec<FunctionConfiguration>("lambda", "UpdateFunctionCode", { FunctionName: fn.FunctionName, ZipFile: { zipFiles: { [fileName]: source } } }),
    successMessage: () => `Function ${fn.FunctionName} code deployed`,
    onSuccess: (out, source) => {
      if (!out.CodeSha256) return;
      const next = { sha: out.CodeSha256, fileName, code: source };
      rememberCode(region, fn.FunctionName, next);
      setStored(next);
    },
  });

  return (
    <Panel
      title="Code source"
      description={`Package: ${fn.PackageType ?? "Zip"}, SHA-256 ${fn.CodeSha256 ?? "-"}`}
      actions={
        <Button variant="primary" disabled={!editable} loading={deploy.isPending} onClick={() => deploy.mutate(code)}>
          Deploy
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        {!known && (
          <p className="flex items-start gap-2 rounded-lg border border-aws-link bg-blue-50 px-3 py-2 text-sm">
            <Info className="mt-0.5 size-4 shrink-0 text-aws-link" aria-hidden />
            <span>
              The deployed package was not created from this browser, so its source can&apos;t be displayed. The editor starts from the {runtime} template; choose Deploy to
              replace the function code.
            </span>
          </p>
        )}
        <CodeField label="Function code" value={code} onChange={setCode} fileName={fileName} rows={18} readOnly={!editable} />
        {deploy.error && <ErrorAlert error={deploy.error} />}
      </div>
    </Panel>
  );
}
