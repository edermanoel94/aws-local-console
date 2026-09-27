"use client";

import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button, Dialog, ErrorAlert, SelectField, TextField } from "@/components/ui";
import { useTarget } from "@/hooks/use-queries";
import { useRegion } from "@/hooks/use-region";
import { useAwsQuery, useConsoleAction } from "../_shared/aws";
import { ConfirmDialog, CopyableText, RemoveIconButton } from "../_shared/controls";
import { formatDateTime } from "../_shared/format";
import { ResourceTable } from "../_shared/resource-table";
import { stageUrl, type Deployment, type Stage } from "./apigw-types";

export function useStages(apiId: string) {
  return useAwsQuery<{ Item?: Stage[] | null }>("apigateway", "GetStages", { RestApiId: apiId });
}

export function StagesTab({ apiId }: { apiId: string }) {
  const stages = useStages(apiId);
  const { target } = useTarget();
  const region = useRegion();
  const deployments = useAwsQuery<{ Items?: Deployment[] | null }>("apigateway", "GetDeployments", { RestApiId: apiId });
  const [removing, setRemoving] = useState<Stage | null>(null);
  const remove = useConsoleAction<Stage>({
    run: (s, exec) => exec("apigateway", "DeleteStage", { RestApiId: apiId, StageName: s.StageName }),
    successMessage: (s) => `Stage ${s.StageName} deleted`,
    onSuccess: () => setRemoving(null),
  });

  return (
    <>
      <ResourceTable<Stage>
        title="Stages"
        description="Each stage is a named reference to a deployment, reachable at its invoke URL."
        items={stages.data ? (stages.data.Item ?? []) : undefined}
        loading={stages.isLoading}
        fetching={stages.isFetching}
        error={stages.error}
        onRefresh={() => stages.refetch()}
        rowKey={(s) => s.StageName}
        filterText={(s) => s.StageName}
        searchPlaceholder="Find stages"
        emptyTitle="No stages"
        emptyDescription="Choose Deploy API to create a stage."
        columns={[
          { header: "Stage", cell: (s) => <span className="font-bold">{s.StageName}</span> },
          { header: "Invoke URL", cell: (s) => <CopyableText value={stageUrl(target, region, apiId, s.StageName)} label={`Copy invoke URL of ${s.StageName}`} /> },
          { header: "Deployment", cell: (s) => <span className="font-mono text-xs">{s.DeploymentId ?? "-"}</span> },
          { header: "Last updated", cell: (s) => formatDateTime(s.LastUpdatedDate ?? s.CreatedDate), className: "whitespace-nowrap" },
          { header: "Actions", className: "w-px text-right", cell: (s) => <RemoveIconButton label={`Delete stage ${s.StageName}`} onClick={() => setRemoving(s)} /> },
        ]}
      />
      <ResourceTable<Deployment>
        title="Deployment history"
        items={deployments.data ? [...(deployments.data.Items ?? [])].sort((a, b) => String(b.CreatedDate).localeCompare(String(a.CreatedDate))) : undefined}
        loading={deployments.isLoading}
        fetching={deployments.isFetching}
        error={deployments.error}
        onRefresh={() => deployments.refetch()}
        rowKey={(d) => d.Id}
        filterText={(d) => `${d.Id} ${d.Description ?? ""}`}
        searchPlaceholder="Find deployments"
        emptyTitle="No deployments"
        columns={[
          { header: "Deployment ID", cell: (d) => <span className="font-mono text-xs">{d.Id}</span> },
          { header: "Description", cell: (d) => d.Description || "-" },
          { header: "Created", cell: (d) => formatDateTime(d.CreatedDate), className: "whitespace-nowrap" },
        ]}
      />
      <ConfirmDialog
        open={!!removing}
        onClose={() => {
          setRemoving(null);
          remove.reset();
        }}
        onConfirm={() => removing && remove.mutate(removing)}
        title="Delete stage"
        confirmLabel="Confirm delete"
        loading={remove.isPending}
        error={remove.error}
      >
        <p>
          Delete stage <strong>{removing?.StageName}</strong>? Its invoke URL stops working.
        </p>
      </ConfirmDialog>
    </>
  );
}

const NEW_STAGE = "__new__";

const deploySchema = z
  .object({
    stage: z.string(),
    stageName: z.string().trim(),
    description: z.string().max(1024),
  })
  .superRefine((v, ctx) => {
    if (v.stage === NEW_STAGE && !/^[a-zA-Z0-9_-]{1,128}$/.test(v.stageName)) {
      ctx.addIssue({ code: "custom", path: ["stageName"], message: "Stage names can contain only letters, numbers, hyphens and underscores." });
    }
  });

type DeployValues = z.infer<typeof deploySchema>;

export function DeployDialog({ apiId, onClose }: { apiId: string; onClose: () => void }) {
  const stages = useStages(apiId);
  const existing = stages.data?.Item ?? [];
  const form = useForm<DeployValues>({ resolver: zodResolver(deploySchema), defaultValues: { stage: NEW_STAGE, stageName: "dev", description: "" } });
  const stage = useWatch({ control: form.control, name: "stage" });

  const deploy = useConsoleAction<DeployValues>({
    run: (v, exec) =>
      exec("apigateway", "CreateDeployment", {
        RestApiId: apiId,
        StageName: v.stage === NEW_STAGE ? v.stageName : v.stage,
        ...(v.description ? { Description: v.description } : {}),
      }),
    successMessage: (v) => `API deployed to stage ${v.stage === NEW_STAGE ? v.stageName : v.stage}`,
    onSuccess: onClose,
  });

  const { errors } = form.formState;
  return (
    <Dialog
      open
      onClose={onClose}
      title="Deploy API"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={deploy.isPending} onClick={form.handleSubmit((v) => deploy.mutate(v))}>
            Deploy
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-aws-muted">Create a deployment of the current resources and methods and point a stage at it.</p>
        <SelectField label="Stage" options={[{ value: NEW_STAGE, label: "*New stage*" }, ...existing.map((s) => ({ value: s.StageName, label: s.StageName }))]} {...form.register("stage")} />
        {stage === NEW_STAGE && <TextField label="Stage name" placeholder="dev" error={errors.stageName?.message} {...form.register("stageName")} />}
        <TextField label="Deployment description - optional" {...form.register("description")} />
        {deploy.error && <ErrorAlert error={deploy.error} />}
      </div>
    </Dialog>
  );
}
