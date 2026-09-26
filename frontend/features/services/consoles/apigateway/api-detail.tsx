"use client";

import { useState } from "react";
import { Rocket } from "lucide-react";
import { Button, ConfirmDeleteDialog, ErrorAlert, Loading, Panel, Tabs } from "@/components/ui";
import { useAwsQuery, useConsoleAction } from "../_shared/aws";
import { formatDateTime } from "../_shared/format";
import { ConsoleHeader, DetailsGrid } from "../_shared/layout";
import { useConsoleNav } from "../_shared/nav";
import type { RestApi } from "./apigw-types";
import { ResourcesTab } from "./resources-tab";
import { StagesTab, DeployDialog } from "./stages-tab";
import { InvokeTab } from "./invoke-tab";

type ApiTab = "resources" | "stages" | "test";

const TABS: { value: ApiTab; label: string }[] = [
  { value: "resources", label: "Resources" },
  { value: "stages", label: "Stages" },
  { value: "test", label: "Test" },
];

export function ApiDetail({ apiId }: { apiId: string }) {
  const { detail, navigate } = useConsoleNav();
  const tab: ApiTab = TABS.some((t) => t.value === detail) ? (detail as ApiTab) : "resources";
  const api = useAwsQuery<RestApi>("apigateway", "GetRestApi", { RestApiId: apiId });
  const [dialog, setDialog] = useState<"delete" | "deploy" | null>(null);
  const name = api.data?.Name ?? apiId;

  const remove = useConsoleAction({
    run: (_: void, exec) => exec("apigateway", "DeleteRestApi", { RestApiId: apiId }),
    successMessage: () => `API ${name} deleted`,
    onSuccess: () => navigate({}),
  });

  return (
    <>
      <ConsoleHeader
        crumbs={[{ label: "APIs", to: {} }, { label: name }]}
        title={name}
        actions={
          <>
            <Button variant="danger" onClick={() => setDialog("delete")} disabled={!api.data}>
              Delete
            </Button>
            <Button variant="primary" onClick={() => setDialog("deploy")} disabled={!api.data}>
              <Rocket className="size-4" aria-hidden />
              Deploy API
            </Button>
          </>
        }
      />
      {api.error ? (
        <ErrorAlert error={api.error} />
      ) : api.isLoading || !api.data ? (
        <Loading />
      ) : (
        <>
          <Panel title="API details">
            <DetailsGrid
              columns={4}
              items={[
                { label: "API ID", value: api.data.Id, mono: true },
                { label: "Endpoint type", value: api.data.EndpointConfiguration?.Types?.join(", ") || "EDGE" },
                { label: "Created", value: formatDateTime(api.data.CreatedDate) },
                { label: "Description", value: api.data.Description },
              ]}
            />
          </Panel>
          <Tabs label="API sections" tabs={TABS} value={tab} onChange={(t) => navigate({ resource: apiId, detail: t })} />
          {tab === "resources" && <ResourcesTab apiId={apiId} />}
          {tab === "stages" && <StagesTab apiId={apiId} />}
          {tab === "test" && <InvokeTab apiId={apiId} />}
        </>
      )}
      {dialog === "deploy" && <DeployDialog apiId={apiId} onClose={() => setDialog(null)} />}
      <ConfirmDeleteDialog
        open={dialog === "delete"}
        onClose={() => {
          setDialog(null);
          remove.reset();
        }}
        onConfirm={() => remove.mutate()}
        resourceKind="API"
        resourceName={name}
        loading={remove.isPending}
        error={remove.error}
      />
    </>
  );
}
