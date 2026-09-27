"use client";

import { SelectField } from "@/components/ui";
import { grantLambdaInvoke, type Exec } from "../_shared/aws";
import { useFunctionOptions, useQueueOptions, useTopicOptions } from "../_shared/pickers";
import { TARGET_TYPES, type TargetType } from "./events-types";

/** Target type + target resource selectors. Controlled by the parent form. */
export function TargetFields({
  type,
  arn,
  onTypeChange,
  onArnChange,
  error,
  optional,
}: {
  type: TargetType;
  arn: string;
  onTypeChange: (type: TargetType) => void;
  onArnChange: (arn: string) => void;
  error?: string;
  optional?: boolean;
}) {
  const queues = useQueueOptions(type === "sqs");
  const functions = useFunctionOptions(type === "lambda");
  const topics = useTopicOptions(type === "sns");
  const source = type === "sqs" ? queues : type === "lambda" ? functions : topics;
  const noun = TARGET_TYPES.find((t) => t.value === type)?.label.toLowerCase() ?? "target";
  const options = [
    { value: "", label: source.isLoading ? "Loading..." : optional ? "No target" : (source.data?.length ?? 0) === 0 ? `No ${noun}s found` : `Choose a ${noun}` },
    ...(source.data ?? []),
  ];
  return (
    <div className="grid gap-4 md:grid-cols-[220px_1fr]">
      <SelectField
        label="Target type"
        options={TARGET_TYPES}
        value={type}
        onChange={(e) => {
          onTypeChange(e.target.value as TargetType);
          onArnChange("");
        }}
      />
      <SelectField label="Target" options={options} value={arn} onChange={(e) => onArnChange(e.target.value)} error={error} description={arn ? <span className="font-mono break-all">{arn}</span> : undefined} />
    </div>
  );
}

/** Adds a target to a rule; Lambda targets also get an invoke permission (required on AWS, best effort on Floci). */
export async function addTarget(exec: Exec, rule: { name: string; bus: string; arn?: string }, targetArn: string, existingIds: string[], permissionRequired: boolean) {
  let n = existingIds.length + 1;
  while (existingIds.includes(`target-${n}`)) n++;
  const out = await exec<{ FailedEntryCount?: number; FailedEntries?: { ErrorCode?: string; ErrorMessage?: string }[] | null }>("events", "PutTargets", {
    Rule: rule.name,
    EventBusName: rule.bus,
    Targets: [{ Id: `target-${n}`, Arn: targetArn }],
  });
  if (out.FailedEntryCount) {
    const failure = out.FailedEntries?.[0];
    throw new Error(`${failure?.ErrorCode ?? "PutTargetsFailed"}: ${failure?.ErrorMessage ?? "The target could not be added."}`);
  }
  if (targetArn.startsWith("arn:aws:lambda:") && rule.arn) {
    await grantLambdaInvoke(exec, permissionRequired, {
      FunctionName: targetArn,
      StatementId: `events-${rule.name}-${Date.now()}`.slice(0, 100),
      Principal: "events.amazonaws.com",
      SourceArn: rule.arn,
    });
  }
}
