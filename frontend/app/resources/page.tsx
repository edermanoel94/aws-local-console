import type { Metadata } from "next";
import { Suspense } from "react";
import { Loading } from "@/components/ui";
import { ClientOnly } from "@/components/layout/client-only";
import { PageHeader } from "@/components/layout/page-header";
import { ResourceExplorer } from "@/features/resources/resource-explorer";

export const metadata: Metadata = { title: "Resources - AWS Local Console" };

export default function ResourcesPage() {
  return (
    <>
      <PageHeader
        title="Resource Explorer"
        description="Search and filter resources across every service by name, ARN, region and tags."
        breadcrumbs={[{ label: "AWS Local Console", href: "/dashboard" }, { label: "Resources" }]}
      />
      <Suspense fallback={<Loading />}>
        <ClientOnly fallback={<Loading />}>
          <ResourceExplorer />
        </ClientOnly>
      </Suspense>
    </>
  );
}
