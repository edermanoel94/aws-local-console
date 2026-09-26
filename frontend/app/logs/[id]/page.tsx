import type { Metadata } from "next";
import { LogDetail } from "@/features/logs/log-detail";

export const metadata: Metadata = { title: "Request Inspector - AWS Local Console" };

export default async function LogDetailPage({ params }: PageProps<"/logs/[id]">) {
  const { id } = await params;
  return <LogDetail id={decodeURIComponent(id)} />;
}
