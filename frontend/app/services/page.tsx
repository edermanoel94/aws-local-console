import type { Metadata } from "next";
import { ServiceCatalog } from "@/features/services/service-catalog";

export const metadata: Metadata = { title: "Services - AWS Local Console" };

export default function ServicesPage() {
  return <ServiceCatalog />;
}
