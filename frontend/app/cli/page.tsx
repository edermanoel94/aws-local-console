import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { CliConsole } from "@/features/cli/cli-console";

export const metadata: Metadata = { title: "CLI - AWS Local Console" };

export default function CliPage() {
  return (
    <>
      <PageHeader
        title="CLI"
        description="Run AWS CLI style commands (aws <service> <command> --flag value) against Floci. Every command is audited in Logs."
        breadcrumbs={[{ label: "AWS Local Console", href: "/dashboard" }, { label: "CLI" }]}
      />
      <CliConsole />
    </>
  );
}
