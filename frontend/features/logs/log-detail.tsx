"use client";

import { ErrorAlert, Loading, Panel } from "@/components/ui";
import { PageHeader } from "@/components/layout/page-header";
import { RequestInspector, fromLogEntry } from "@/components/aws/request-inspector";
import { SERVICE_SHORT_NAMES } from "@/components/aws/service-icon";
import { useLog } from "@/hooks/use-queries";

/** Full page Request Inspector for one audit log entry (/logs/[id]). */
export function LogDetail({ id }: { id: string }) {
  const log = useLog(id);
  const title = log.data ? `${SERVICE_SHORT_NAMES[log.data.service] ?? log.data.service} ${log.data.operation}` : "Request Inspector";
  return (
    <>
      <PageHeader
        title={title}
        description="Request Inspector"
        breadcrumbs={[{ label: "AWS Local Console", href: "/dashboard" }, { label: "Logs", href: "/logs" }, { label: id }]}
      />
      <Panel>
        {log.isPending ? <Loading /> : log.isError ? <ErrorAlert error={log.error} /> : <RequestInspector execution={fromLogEntry(log.data)} showLogLink={false} defaultTab="request" />}
      </Panel>
    </>
  );
}
