import type { Metadata } from "next";
import { Suspense } from "react";
import { Loading } from "@/components/ui";
import { ClientOnly } from "@/components/layout/client-only";
import { ServiceDetailView } from "@/features/services/service-detail";

export async function generateMetadata({ params }: PageProps<"/services/[service]">): Promise<Metadata> {
  const { service } = await params;
  return { title: `${service} - Services - AWS Local Console` };
}

export default async function ServiceDetailPage({ params }: PageProps<"/services/[service]">) {
  const { service } = await params;
  return (
    <Suspense fallback={<Loading />}>
      <ClientOnly fallback={<Loading />}>
          <ServiceDetailView serviceId={decodeURIComponent(service)} />
        </ClientOnly>
    </Suspense>
  );
}
