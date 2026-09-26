import type { Metadata } from "next";
import { Suspense } from "react";
import { Loading } from "@/components/ui";
import { ClientOnly } from "@/components/layout/client-only";
import { PageHeader } from "@/components/layout/page-header";
import { EventsExplorer } from "@/features/events/events-explorer";

export const metadata: Metadata = { title: "Events - AWS Local Console" };

export default function EventsPage() {
  return (
    <>
      <PageHeader
        title="Events"
        description="Resource lifecycle events and how resources relate to each other."
        breadcrumbs={[{ label: "AWS Local Console", href: "/dashboard" }, { label: "Events" }]}
      />
      <Suspense fallback={<Loading />}>
        <ClientOnly fallback={<Loading />}>
          <EventsExplorer />
        </ClientOnly>
      </Suspense>
    </>
  );
}
