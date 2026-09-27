"use client";

import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { api, API_BASE_PATH } from "@/lib/api";
import { Badge, Button, ErrorAlert, Loading, Panel, SelectField } from "@/components/ui";
import { PageHeader } from "@/components/layout/page-header";
import { useRegions, useTargetStatus } from "@/hooks/use-queries";
import { useRegion } from "@/hooks/use-region";
import { useHydrated } from "@/hooks/use-hydrated";
import { usePreferences } from "@/stores/preferences";
import { toast } from "@/stores/toast";
import { THEME_OPTIONS } from "@/lib/theme";
import { RadioCards } from "@/features/services/consoles/_shared/controls";

export function SettingsView() {
  const health = useQuery({ queryKey: ["health"], queryFn: api.health, retry: 0 });
  const regions = useRegions();
  const hydrated = useHydrated();
  const setRegion = usePreferences((s) => s.setRegion);
  const favorites = usePreferences((s) => s.favorites);
  const clearFavorites = usePreferences((s) => s.clearFavorites);
  const favoriteCount = hydrated ? favorites.length : 0;
  const storedTheme = usePreferences((s) => s.theme);
  const setTheme = usePreferences((s) => s.setTheme);
  const theme = hydrated ? storedTheme : "system";

  const regionValue = useRegion();
  const regionOptions = (regions.data ?? [{ name: regionValue, label: regionValue, default: true }]).map((r) => ({
    value: r.name,
    label: r.label && r.label !== r.name ? `${r.name} - ${r.label}` : r.name,
  }));
  if (!regionOptions.some((o) => o.value === regionValue)) regionOptions.unshift({ value: regionValue, label: regionValue });

  return (
    <>
      <PageHeader
        title="Settings"
        description="Environment endpoints and console preferences."
        breadcrumbs={[{ label: "AWS Local Console", href: "/dashboard" }, { label: "Settings" }]}
      />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <TargetPanel />

        <div className="flex flex-col gap-4">
          <Panel title="Go API" description="The browser reaches the Go API through the console server (API_INTERNAL_URL).">
            <dl className="grid grid-cols-[9rem_1fr] gap-y-2.5 text-sm">
              <Row label="Path">
                <span className="font-mono text-[13px]">{API_BASE_PATH}</span>
              </Row>
              <Row label="Health">
                {health.isPending ? (
                  <span className="text-aws-muted">Checking...</span>
                ) : health.isError ? (
                  <Badge tone="red">Unreachable</Badge>
                ) : (
                  <Badge tone="green">{health.data.status}</Badge>
                )}
              </Row>
              <Row label="Version">{health.data?.version ?? "-"}</Row>
            </dl>
          </Panel>

          <Panel title="Preferences" description="Stored in this browser.">
            <div className="flex flex-col gap-5">
              <RadioCards
                legend="Theme"
                name="theme"
                columns={3}
                value={theme}
                onChange={(next) => {
                  setTheme(next);
                  toast.success(`Theme set to ${THEME_OPTIONS.find((o) => o.value === next)?.label.toLowerCase()}`);
                }}
                options={THEME_OPTIONS}
              />
              <SelectField
                label="Default region"
                description="Used by every console, the API Explorer and the CLI. Same as the top bar selector."
                value={regionValue}
                onChange={(e) => {
                  setRegion(e.target.value);
                  toast.success(`Default region set to ${e.target.value}`);
                }}
                options={regionOptions}
                className="max-w-sm"
              />
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-aws-border pt-4">
                <div>
                  <p className="text-sm font-bold">Favorites</p>
                  <p className="text-sm text-aws-muted">
                    {favoriteCount === 0 ? "No favorite services." : `${favoriteCount} favorite service${favoriteCount === 1 ? "" : "s"}.`}
                  </p>
                </div>
                <Button
                  variant="danger"
                  disabled={favoriteCount === 0}
                  onClick={() => {
                    clearFavorites();
                    toast.success("Favorites cleared");
                  }}
                >
                  Clear favorites
                </Button>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-aws-border pt-4">
                <div>
                  <p className="text-sm font-bold">CLI history</p>
                  <p className="text-sm text-aws-muted">Commands recalled with the Up arrow in the CLI.</p>
                </div>
                <Button
                  onClick={() => {
                    try {
                      localStorage.removeItem("aws-local-console-cli-history");
                    } catch {
                      // storage unavailable
                    }
                    toast.success("CLI history cleared");
                  }}
                >
                  Clear CLI history
                </Button>
              </div>
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}

/** Floci endpoint details, or the AWS account and identity the Go API credentials resolve to. */
function TargetPanel() {
  const status = useTargetStatus();
  const aws = status.data?.target === "aws";
  return (
    <Panel
      className="self-start"
      title={status.data ? (aws ? "AWS account" : "Floci endpoint") : "Target"}
      description={
        aws
          ? "Read only. The Go API uses the AWS credentials of its environment (AWS SDK default credential chain)."
          : "Read only. Configured on the Go API with FLOCI_ENDPOINT."
      }
    >
      {status.isPending ? (
        <Loading />
      ) : status.isError ? (
        <ErrorAlert error={status.error} />
      ) : (
        <div className="flex flex-col gap-4">
          <dl className="grid grid-cols-[9rem_1fr] gap-y-2.5 text-sm">
            {aws ? (
              <>
                <Row label="Account id">
                  <span className="font-mono text-[13px]">{status.data.accountId || "-"}</span>
                </Row>
                <Row label="Identity">
                  <span className="font-mono text-[13px]">{status.data.identityArn ?? "-"}</span>
                </Row>
                <Row label="Credentials">{status.data.credentialSource ?? "-"}</Row>
                <Row label="Default region">
                  <span className="font-mono text-[13px]">{status.data.region}</span>
                </Row>
              </>
            ) : (
              <Row label="Endpoint">
                <span className="font-mono text-[13px]">{status.data.endpoint}</span>
              </Row>
            )}
            <Row label="Status">
              <Badge tone={status.data.healthy ? "green" : "red"}>{status.data.status}</Badge>
            </Row>
            {!aws && (
              <>
                <Row label="Version">{status.data.version ?? "-"}</Row>
                <Row label="Edition">{status.data.edition ?? "-"}</Row>
              </>
            )}
            <Row label="Latency">{status.data.latencyMs}ms</Row>
            {!aws && (
              <Row label="Account id">
                <span className="font-mono text-[13px]">{status.data.accountId}</span>
              </Row>
            )}
            {status.data.error && (
              <Row label="Error">
                <span className="text-aws-red">{status.data.error}</span>
              </Row>
            )}
          </dl>
          {status.data.services.length > 0 && <FlociServices services={status.data.services} />}
        </div>
      )}
    </Panel>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-aws-muted">{label}</dt>
      <dd className="min-w-0 break-all">{children}</dd>
    </>
  );
}

const COLLAPSED_SERVICE_COUNT = 24;

function FlociServices({ services }: { services: { id: string; status: string }[] }) {
  const [expanded, setExpanded] = useState(false);
  const sorted = [...services].sort((a, b) => a.id.localeCompare(b.id));
  const visible = expanded ? sorted : sorted.slice(0, COLLAPSED_SERVICE_COUNT);
  const running = services.filter((s) => s.status === "running" || s.status === "available").length;
  return (
    <div>
      <p className="mb-2 text-xs font-bold tracking-wide text-aws-muted uppercase">
        Floci services ({running} of {services.length} running)
      </p>
      <ul className="flex flex-wrap gap-1.5">
        {visible.map((s) => (
          <li key={s.id}>
            <Badge tone={s.status === "running" || s.status === "available" ? "green" : "gray"}>
              {s.id}
              {s.status !== "running" && <span className="ml-1 font-normal opacity-80">{s.status}</span>}
            </Badge>
          </li>
        ))}
      </ul>
      {sorted.length > COLLAPSED_SERVICE_COUNT && (
        <Button variant="ghost" size="sm" className="mt-2 -ml-3" onClick={() => setExpanded((e) => !e)} aria-expanded={expanded}>
          {expanded ? "Show fewer" : `Show all (${sorted.length})`}
        </Button>
      )}
    </div>
  );
}
