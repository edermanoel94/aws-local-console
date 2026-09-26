import type { Metadata } from "next";
import { Suspense } from "react";
import { Loading } from "@/components/ui";
import { ClientOnly } from "@/components/layout/client-only";
import { PageHeader } from "@/components/layout/page-header";
import { ApiExplorer } from "@/features/operations/api-explorer";

export const metadata: Metadata = { title: "API Explorer - AWS Local Console" };

export default function ApiExplorerPage() {
  return (
    <>
      <PageHeader
        title="API Explorer"
        description="Execute any AWS SDK operation against Floci and inspect the raw request and response."
        breadcrumbs={[{ label: "AWS Local Console", href: "/dashboard" }, { label: "API Explorer" }]}
      />
      <Suspense fallback={<Loading />}>
        <ClientOnly fallback={<Loading />}>
          <ApiExplorer />
        </ClientOnly>
      </Suspense>
    </>
  );
}
