"use client";

import { useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus } from "lucide-react";
import { Badge, Button, CodeBlock, Dialog, EmptyState, ErrorAlert, Loading, Panel, SelectField, TextAreaField, TextField } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useRegion } from "@/hooks/use-region";
import { useQuery } from "@tanstack/react-query";
import { api, OperationError } from "@/lib/api";
import { CONSOLE_KEY, nameFromArn, useAwsQuery, useConsoleAction } from "../_shared/aws";
import { ConfirmDialog, RadioCards } from "../_shared/controls";
import { prettyJson } from "../_shared/format";
import { DetailsGrid, SectionTitle } from "../_shared/layout";
import { useConsoleNav } from "../_shared/nav";
import { useFunctionOptions } from "../_shared/pickers";
import { RefreshButton } from "../_shared/resource-table";
import { jsonText } from "../_shared/validation";
import { executeApiArn, functionArnFromUri, HTTP_METHODS, lambdaIntegrationUri, METHOD_TONES, type ApiResource, type Method } from "./apigw-types";

export function useApiResources(apiId: string) {
  return useAwsQuery<{ Items?: ApiResource[] | null }>("apigateway", "GetResources", { RestApiId: apiId, Limit: 500 });
}

/**
 * Methods of one resource. Floci's GetResources never returns resourceMethods, so each verb is probed with GetMethod
 * (sent with source "system" because it is background discovery, not a user action).
 */
export function useResourceMethods(apiId: string, resourceId: string | undefined) {
  const region = useRegion();
  return useQuery({
    queryKey: [CONSOLE_KEY, "apigateway", "methods", apiId, resourceId, region],
    enabled: !!resourceId,
    queryFn: async () => {
      const found = await Promise.all(
        HTTP_METHODS.map(async (m) => {
          const res = await api.execute({ service: "apigateway", operation: "GetMethod", region, input: { RestApiId: apiId, ResourceId: resourceId, HttpMethod: m } }, "system");
          if (res.status === "success") return m;
          if (res.error?.code === "NotFoundException") return null;
          throw new OperationError(res);
        }),
      );
      return found.filter((m): m is string => m !== null);
    },
  });
}

export function ResourcesTab({ apiId }: { apiId: string }) {
  const { item, navigate } = useConsoleNav();
  const resources = useApiResources(apiId);
  const items = [...(resources.data?.Items ?? [])].sort((a, b) => a.Path.localeCompare(b.Path));
  const selected = items.find((r) => r.Id === item) ?? items[0];
  const [dialog, setDialog] = useState<"resource" | "method" | null>(null);
  const [existingMethods, setExistingMethods] = useState<string[]>([]);

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[300px_1fr] xl:grid-cols-[340px_1fr]">
      <Panel
        title="Resources"
        count={resources.data ? items.length : undefined}
        bodyClassName="flex flex-col gap-2 px-2! py-2!"
        actions={<RefreshButton onClick={() => resources.refetch()} spinning={resources.isFetching} />}
      >
        <Button className="mx-1 mt-1" onClick={() => setDialog("resource")} disabled={!resources.data}>
          <Plus className="size-4" aria-hidden />
          Create resource
        </Button>
        {resources.error ? (
          <ErrorAlert error={resources.error} />
        ) : resources.isLoading ? (
          <Loading className="px-3" />
        ) : (
          <ul aria-label="API resources" className="flex flex-col gap-0.5">
            {items.map((r) => {
              const depth = r.Path === "/" ? 0 : r.Path.split("/").length - 1;
              const active = r.Id === selected?.Id;
              return (
                <li key={r.Id}>
                  <button
                    type="button"
                    aria-current={active || undefined}
                    onClick={() => navigate({ resource: apiId, detail: "resources", item: r.Id })}
                    className={cn("flex w-full rounded-lg px-3 py-1.5 text-left", active ? "bg-aws-info-bg ring-1 ring-aws-link" : "hover:bg-aws-panel")}
                    style={{ paddingLeft: `${12 + depth * 14}px` }}
                  >
                    <span className="font-mono text-sm font-bold break-all text-aws-ink">{r.Path === "/" ? "/" : `/${r.PathPart ?? r.Path.split("/").pop()}`}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
      {selected ? (
        <ResourceDetail
          key={selected.Id}
          apiId={apiId}
          resource={selected}
          onCreateMethod={(existing) => {
            setExistingMethods(existing);
            setDialog("method");
          }}
        />
      ) : (
        !resources.isLoading && (
          <Panel>
            <EmptyState title="No resources" />
          </Panel>
        )
      )}
      {dialog === "resource" && (
        <CreateResourceDialog apiId={apiId} resources={items} defaultParent={selected?.Id ?? ""} onClose={() => setDialog(null)} onCreated={(id) => navigate({ resource: apiId, detail: "resources", item: id })} />
      )}
      {dialog === "method" && selected && <CreateMethodDialog apiId={apiId} resource={selected} existing={existingMethods} onClose={() => setDialog(null)} />}
    </div>
  );
}

function ResourceDetail({ apiId, resource, onCreateMethod }: { apiId: string; resource: ApiResource; onCreateMethod: (existing: string[]) => void }) {
  const { navigate } = useConsoleNav();
  const probed = useResourceMethods(apiId, resource.Id);
  const methods = probed.data ?? [];
  const [method, setMethod] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const remove = useConsoleAction({
    run: (_: void, exec) => exec("apigateway", "DeleteResource", { RestApiId: apiId, ResourceId: resource.Id }),
    successMessage: () => `Resource ${resource.Path} deleted`,
    onSuccess: () => {
      setRemoving(false);
      navigate({ resource: apiId, detail: "resources" });
    },
  });
  const current = method && methods.includes(method) ? method : (methods[0] ?? null);

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Panel
        title={<span className="font-mono">{resource.Path}</span>}
        actions={
          <>
            {resource.Path !== "/" && (
              <Button variant="danger" onClick={() => setRemoving(true)}>
                Delete resource
              </Button>
            )}
            <Button variant="primary" onClick={() => onCreateMethod(methods)} disabled={probed.isLoading}>
              <Plus className="size-4" aria-hidden />
              Create method
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <DetailsGrid
            items={[
              { label: "Resource ID", value: resource.Id, mono: true },
              { label: "Path", value: resource.Path, mono: true },
              { label: "Methods", value: probed.isLoading ? "Loading..." : methods.length ? methods.join(", ") : "None" },
            ]}
          />
          {methods.length > 0 && (
            <div role="tablist" aria-label="Methods" className="flex flex-wrap gap-2">
              {methods.map((m) => (
                <button
                  key={m}
                  type="button"
                  role="tab"
                  aria-selected={m === current}
                  onClick={() => setMethod(m)}
                  className={cn("rounded-full border px-3 py-1 font-mono text-xs font-bold", m === current ? "border-aws-link bg-aws-info-bg text-aws-link" : "border-aws-border-strong bg-aws-surface hover:bg-aws-panel")}
                >
                  {m}
                </button>
              ))}
            </div>
          )}
        </div>
      </Panel>
      {probed.error ? (
        <ErrorAlert error={probed.error} />
      ) : probed.isLoading ? (
        <Panel>
          <Loading label="Loading methods" />
        </Panel>
      ) : current ? (
        <MethodDetail key={current} apiId={apiId} resource={resource} httpMethod={current} />
      ) : (
        <Panel>
          <EmptyState title="No methods" description="Create a method to handle requests on this resource with a Lambda function, a mock response or an HTTP backend." />
        </Panel>
      )}
      <ConfirmDialog
        open={removing}
        onClose={() => {
          setRemoving(false);
          remove.reset();
        }}
        onConfirm={() => remove.mutate()}
        title="Delete resource"
        confirmLabel="Confirm delete"
        loading={remove.isPending}
        error={remove.error}
      >
        <p>
          Delete resource <strong className="font-mono">{resource.Path}</strong> and all its child resources and methods?
        </p>
      </ConfirmDialog>
    </div>
  );
}

const INTEGRATION_LABELS: Record<string, string> = { AWS_PROXY: "Lambda proxy", MOCK: "Mock", HTTP_PROXY: "HTTP proxy", HTTP: "HTTP", AWS: "AWS service" };

/** Only the fields that apply to the integration type (a mock has no endpoint or backend HTTP method). */
function integrationDetails(integration: Method["MethodIntegration"], fnArn: string | null, mockStatus: string | undefined) {
  const type = { label: "Integration type", value: integration?.Type ? (INTEGRATION_LABELS[integration.Type] ?? integration.Type) : "None" };
  if (!integration?.Type) return [type];
  if (integration.Type === "MOCK") return [type, { label: "Status code", value: mockStatus }];
  return [
    type,
    fnArn ? { label: "Lambda function", value: nameFromArn(fnArn) } : { label: "Endpoint", value: integration.Uri, mono: true },
    { label: "Integration HTTP method", value: integration.HttpMethod },
  ];
}

function MethodDetail({ apiId, resource, httpMethod }: { apiId: string; resource: ApiResource; httpMethod: string }) {
  const method = useAwsQuery<Method>("apigateway", "GetMethod", { RestApiId: apiId, ResourceId: resource.Id, HttpMethod: httpMethod });
  const [removing, setRemoving] = useState(false);
  const remove = useConsoleAction({
    run: (_: void, exec) => exec("apigateway", "DeleteMethod", { RestApiId: apiId, ResourceId: resource.Id, HttpMethod: httpMethod }),
    successMessage: () => `Method ${httpMethod} ${resource.Path} deleted`,
    onSuccess: () => setRemoving(false),
  });
  const integration = method.data?.MethodIntegration;
  const fnArn = functionArnFromUri(integration?.Uri);
  const mockResponse = Object.values(integration?.IntegrationResponses ?? {})[0];
  const mockBody = mockResponse?.ResponseTemplates?.["application/json"];
  const mockStatus = mockResponse?.StatusCode;

  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <Badge tone={METHOD_TONES[httpMethod] ?? "gray"}>{httpMethod}</Badge>
          <span className="font-mono">{resource.Path}</span>
        </span>
      }
      actions={
        <Button variant="danger" onClick={() => setRemoving(true)}>
          Delete method
        </Button>
      }
    >
      {method.error ? (
        <ErrorAlert error={method.error} />
      ) : method.isLoading ? (
        <Loading />
      ) : (
        <div className="flex flex-col gap-5">
          <section aria-label="Method request">
            <SectionTitle>Method request</SectionTitle>
            <DetailsGrid items={[{ label: "Authorization", value: method.data?.AuthorizationType ?? "NONE" }]} />
          </section>
          <section aria-label="Integration request">
            <SectionTitle>Integration request</SectionTitle>
            <DetailsGrid items={integrationDetails(integration, fnArn, mockStatus)} />
          </section>
          {mockBody !== undefined && (
            <section aria-label="Mock response template">
              <SectionTitle>Mock response template</SectionTitle>
              <CodeBlock text={prettyJson(mockBody)} className="max-h-60 leading-normal whitespace-pre-wrap" />
            </section>
          )}
        </div>
      )}
      <ConfirmDialog
        open={removing}
        onClose={() => {
          setRemoving(false);
          remove.reset();
        }}
        onConfirm={() => remove.mutate()}
        title="Delete method"
        confirmLabel="Confirm delete"
        loading={remove.isPending}
        error={remove.error}
      >
        <p>
          Delete method <strong>{httpMethod}</strong> on <strong className="font-mono">{resource.Path}</strong>?
        </p>
      </ConfirmDialog>
    </Panel>
  );
}

const resourceSchema = z.object({
  parentId: z.string().min(1, "Choose a parent resource."),
  pathPart: z
    .string()
    .trim()
    .min(1, "Enter a resource path.")
    .regex(/^(\{[a-zA-Z0-9._-]+\+?\}|[a-zA-Z0-9._-]+)$/, 'Use letters, numbers, ".", "_", "-" or a path parameter such as {id} or {proxy+}.'),
});

type ResourceValues = z.infer<typeof resourceSchema>;

function CreateResourceDialog({
  apiId,
  resources,
  defaultParent,
  onClose,
  onCreated,
}: {
  apiId: string;
  resources: ApiResource[];
  defaultParent: string;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const form = useForm<ResourceValues>({ resolver: zodResolver(resourceSchema), defaultValues: { parentId: defaultParent, pathPart: "" } });
  const create = useConsoleAction<ResourceValues, ApiResource>({
    run: (v, exec) => exec<ApiResource>("apigateway", "CreateResource", { RestApiId: apiId, ParentId: v.parentId, PathPart: v.pathPart }),
    successMessage: (_, r) => `Resource ${r.Path} created`,
    onSuccess: (r) => {
      onClose();
      onCreated(r.Id);
    },
  });
  const { errors } = form.formState;
  return (
    <Dialog
      open
      onClose={onClose}
      title="Create resource"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={create.isPending} onClick={form.handleSubmit((v) => create.mutate(v))}>
            Create
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <SelectField label="Parent resource" options={resources.map((r) => ({ value: r.Id, label: r.Path }))} error={errors.parentId?.message} {...form.register("parentId")} />
        <TextField label="Resource path" placeholder="hello" description="Path segment, e.g. orders or {orderId}." error={errors.pathPart?.message} autoFocus {...form.register("pathPart")} />
        {create.error && <ErrorAlert error={create.error} />}
      </div>
    </Dialog>
  );
}

const methodSchema = z
  .object({
    httpMethod: z.string(),
    integration: z.enum(["AWS_PROXY", "MOCK", "HTTP_PROXY"]),
    functionArn: z.string(),
    statusCode: z.string().regex(/^[1-5]\d\d$/, "Enter an HTTP status code."),
    mockBody: jsonText("Mock response body"),
    endpointUrl: z.string().trim(),
  })
  .superRefine((v, ctx) => {
    if (v.integration === "AWS_PROXY" && !v.functionArn) ctx.addIssue({ code: "custom", path: ["functionArn"], message: "Choose a Lambda function." });
    if (v.integration === "HTTP_PROXY" && !/^https?:\/\//.test(v.endpointUrl)) ctx.addIssue({ code: "custom", path: ["endpointUrl"], message: "Enter an http:// or https:// URL." });
  });

type MethodValues = z.infer<typeof methodSchema>;

function CreateMethodDialog({ apiId, resource, existing, onClose }: { apiId: string; resource: ApiResource; existing: string[]; onClose: () => void }) {
  const region = useRegion();
  const functions = useFunctionOptions();
  const available = HTTP_METHODS.filter((m) => !existing.includes(m));
  const form = useForm<MethodValues>({
    resolver: zodResolver(methodSchema),
    defaultValues: { httpMethod: available[0] ?? "GET", integration: "AWS_PROXY", functionArn: "", statusCode: "200", mockBody: '{\n  "message": "Hello from API Gateway"\n}', endpointUrl: "" },
  });
  const integration = useWatch({ control: form.control, name: "integration" });

  const create = useConsoleAction<MethodValues>({
    run: async (v, exec) => {
      const base = { RestApiId: apiId, ResourceId: resource.Id, HttpMethod: v.httpMethod };
      await exec("apigateway", "PutMethod", { ...base, AuthorizationType: "NONE" });
      if (v.integration === "AWS_PROXY") {
        await exec("apigateway", "PutIntegration", { ...base, Type: "AWS_PROXY", IntegrationHttpMethod: "POST", Uri: lambdaIntegrationUri(region, v.functionArn) });
        try {
          await exec("lambda", "AddPermission", {
            FunctionName: v.functionArn,
            StatementId: `apigateway-${apiId}-${v.httpMethod}-${resource.Id}-${Date.now()}`.slice(0, 100),
            Action: "lambda:InvokeFunction",
            Principal: "apigateway.amazonaws.com",
            SourceArn: executeApiArn(region, apiId, v.httpMethod, resource.Path),
          });
        } catch {
          // Resource-based policies are optional on Floci; the integration works without them.
        }
      } else if (v.integration === "MOCK") {
        await exec("apigateway", "PutIntegration", { ...base, Type: "MOCK", RequestTemplates: { "application/json": JSON.stringify({ statusCode: Number(v.statusCode) }) } });
        await exec("apigateway", "PutMethodResponse", { ...base, StatusCode: v.statusCode });
        await exec("apigateway", "PutIntegrationResponse", { ...base, StatusCode: v.statusCode, ResponseTemplates: { "application/json": v.mockBody } });
      } else {
        await exec("apigateway", "PutIntegration", { ...base, Type: "HTTP_PROXY", IntegrationHttpMethod: v.httpMethod, Uri: v.endpointUrl });
      }
    },
    successMessage: (v) => `Method ${v.httpMethod} ${resource.Path} created`,
    onSuccess: onClose,
  });

  const { errors } = form.formState;
  const fnOptions = [{ value: "", label: functions.isLoading ? "Loading functions..." : (functions.data?.length ?? 0) === 0 ? "No functions found" : "Choose a function" }, ...(functions.data ?? [])];
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Create method on ${resource.Path}`}
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={create.isPending} onClick={form.handleSubmit((v) => create.mutate(v))}>
            Create
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <SelectField label="HTTP method" options={available.map((m) => ({ value: m, label: m }))} {...form.register("httpMethod")} />
        <Controller
          control={form.control}
          name="integration"
          render={({ field }) => (
            <RadioCards
              legend="Integration type"
              columns={3}
              name="integration-type"
              value={field.value}
              onChange={field.onChange}
              options={[
                { value: "AWS_PROXY", label: "Lambda proxy", description: "Send the request to a Lambda function." },
                { value: "MOCK", label: "Mock", description: "Return a fixed response without a backend." },
                { value: "HTTP_PROXY", label: "HTTP proxy", description: "Forward the request to an HTTP endpoint." },
              ]}
            />
          )}
        />
        {integration === "AWS_PROXY" && <SelectField label="Lambda function" options={fnOptions} error={errors.functionArn?.message} {...form.register("functionArn")} />}
        {integration === "MOCK" && (
          <>
            <TextField label="Response status code" inputMode="numeric" error={errors.statusCode?.message} {...form.register("statusCode")} />
            <TextAreaField label="Mock response body" rows={5} error={errors.mockBody?.message} {...form.register("mockBody")} />
          </>
        )}
        {integration === "HTTP_PROXY" && <TextField label="Endpoint URL" placeholder="https://example.com/{proxy}" error={errors.endpointUrl?.message} {...form.register("endpointUrl")} />}
        {(create.error || functions.error) && <ErrorAlert error={create.error ?? functions.error} />}
      </div>
    </Dialog>
  );
}
