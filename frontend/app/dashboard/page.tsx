import type { Metadata } from "next";
import { DashboardView } from "@/features/dashboard/dashboard-view";

export const metadata: Metadata = { title: "Dashboard - AWS Local Console" };

export default function DashboardPage() {
  return <DashboardView />;
}
