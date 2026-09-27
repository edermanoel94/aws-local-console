"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Braces } from "lucide-react";
import { ApiError } from "@/lib/api";
import { EmptyState, ErrorAlert, Loading, Tabs } from "@/components/ui";
import { PageHeader } from "@/components/layout/page-header";
import { ServiceIcon } from "@/components/aws/service-icon";
import { AvailabilityBadge } from "@/components/aws/status-badges";
import { useService } from "@/hooks/use-queries";
import { serviceConsoles } from "@/features/services/consoles";
import { ApiExplorer } from "@/features/operations/api-explorer";
import { LogsExplorer } from "@/features/logs/logs-explorer";
import { FavoriteToggle } from "./favorite-toggle";
import { OverviewTab } from "./tabs/overview-tab";
import { OperationsTab } from "./tabs/operations-tab";
import { CoverageTab } from "./tabs/coverage-tab";
import { GenericResources } from "./tabs/generic-resources";

const TABS = [
  { value: "overview", label: "Overview" },
  { value: "resources", label: "Resources" },
  { value: "operations", label: "Operations" },
  { value: "api-explorer", label: "API Explorer" },
  { value: "activity", label: "Activity" },
  { value: "coverage", label: "Coverage" },
] as const;

type TabValue = (typeof TABS)[number]["value"];

function isTab(value: string | null): value is TabValue {
  return TABS.some((t) => t.value === value);
}

/** /services/[service]: header + tabs (Overview, Resources, Operations, API Explorer, Activity, Coverage) selected by ?tab=. */
export function ServiceDetailView({ serviceId }: { serviceId: string }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const service = useService(serviceId);
  const tabParam = searchParams.get("tab");
  const tab: TabValue = isTab(tabParam) ? tabParam : "overview";

  const setTab = (next: TabValue) => {
    const params = new URLSearchParams();
    if (next !== "overview") params.set("tab", next);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const crumbs = [
    { label: "AWS Local Console", href: "/dashboard" },
    { label: "Services", href: "/services" },
    { label: service.data?.shortName ?? serviceId },
  ];

  if (service.isPending) {
    return (
      <>
        <PageHeader title={serviceId} breadcrumbs={crumbs} />
        <Loading />
      </>
    );
  }

  if (service.isError) {
    const notFound = service.error instanceof ApiError && service.error.status === 404;
    return (
      <>
        <PageHeader title={serviceId} breadcrumbs={crumbs} />
        {notFound ? (
          <div className="rounded-2xl border border-aws-border bg-aws-surface">
            <EmptyState title="No such service" description={`"${serviceId}" is not registered in the console.`} action={<Link href="/services">Browse services</Link>} />
          </div>
        ) : (
          <ErrorAlert error={service.error} />
        )}
      </>
    );
  }

  const s = service.data;
  const Console = serviceConsoles[s.id];
  // Services without resources of their own (e.g. DynamoDB Streams) have no Resources tab.
  const tabs = TABS.filter((t) => t.value !== "resources" || s.capabilities.includes("resources"));
  const active: TabValue = tabs.some((t) => t.value === tab) ? tab : "overview";

  return (
    <>
      <PageHeader
        title={s.name}
        description={s.description}
        breadcrumbs={crumbs}
        icon={<ServiceIcon service={s.id} category={s.category} size="lg" />}
        actions={
          <>
            <FavoriteToggle serviceId={s.id} label={s.shortName} className="border border-aws-border-strong bg-aws-surface p-[7px]" />
            <Link
              href={`/api-explorer?service=${encodeURIComponent(s.id)}`}
              className="inline-flex h-8 items-center gap-1.5 rounded-full border border-aws-border-strong bg-aws-surface px-4 text-sm font-bold text-aws-ink no-underline hover:bg-aws-panel"
            >
              <Braces className="size-4" aria-hidden /> Open API Explorer
            </Link>
          </>
        }
        meta={
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-aws-muted">
            <AvailabilityBadge available={s.available} />
            <span>{s.category}</span>
            <span>
              <strong className="text-aws-ink">{s.operationCount}</strong> operations
            </span>
            <span className="font-mono text-[12px]">{s.id}</span>
          </div>
        }
      />

      <Tabs<TabValue> label="Sections" value={active} onChange={setTab} tabs={tabs} className="mb-5" />

      <div role="tabpanel" aria-label={tabs.find((t) => t.value === active)?.label}>
        {active === "overview" && <OverviewTab service={s} onNavigate={setTab} />}
        {active === "resources" && (Console ? <Console serviceId={s.id} /> : <GenericResources service={s} />)}
        {active === "operations" && <OperationsTab service={s} />}
        {active === "api-explorer" && <ApiExplorer presetService={s.id} />}
        {active === "activity" && <LogsExplorer fixedService={s.id} />}
        {active === "coverage" && <CoverageTab service={s} />}
      </div>
    </>
  );
}
