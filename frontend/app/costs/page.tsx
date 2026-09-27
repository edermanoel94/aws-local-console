import type { Metadata } from "next";
import { CostSimulatorView } from "@/features/costs/cost-simulator-view";

export const metadata: Metadata = { title: "Cost Simulator - AWS Local Console" };

export default function CostSimulatorPage() {
  return <CostSimulatorView />;
}
