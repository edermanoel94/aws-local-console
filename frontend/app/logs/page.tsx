import type { Metadata } from "next";
import { Suspense } from "react";
import { Loading } from "@/components/ui";
import { ClientOnly } from "@/components/layout/client-only";
import { PageHeader } from "@/components/layout/page-header";
import { LogsExplorer } from "@/features/logs/logs-explorer";

export const metadata: Metadata = { title: "Logs - AWS Local Console" };

export default function LogsPage() {
  return (
    <>
      <PageHeader
        title="Logs"
        description="Audit trail of every AWS operation, with the full request and response."
        breadcrumbs={[{ label: "AWS Local Console", href: "/dashboard" }, { label: "Logs" }]}
      />
      <Suspense fallback={<Loading />}>
        <ClientOnly fallback={<Loading />}>
          <LogsExplorer syncUrl />
        </ClientOnly>
      </Suspense>
    </>
  );
}
