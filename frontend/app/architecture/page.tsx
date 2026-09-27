import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { ArchitectureView } from "@/features/architecture/architecture-view";

export const metadata: Metadata = { title: "Architecture - AWS Local Console" };

export default function ArchitecturePage() {
  return (
    <>
      <PageHeader
        title="Architecture"
        description="Resources and the relationships discovered from their real state."
        breadcrumbs={[{ label: "AWS Local Console", href: "/dashboard" }, { label: "Architecture" }]}
      />
      <ArchitectureView />
    </>
  );
}
