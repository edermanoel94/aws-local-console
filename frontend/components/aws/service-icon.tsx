import {
  Archive,
  Box,
  Cpu,
  Database,
  HardDrive,
  Inbox,
  Lambda,
  Megaphone,
  Network,
  Radio,
  ScrollText,
  Shield,
  ShieldCheck,
  Table2,
  Waypoints,
  Workflow,
  ChartColumn,
  Gauge,
  type LucideIcon,
} from "lucide-react";
import type { ServiceCategory } from "@/types/api";
import { cn } from "@/lib/cn";

/** Official AWS architecture icon category colors. */
export const CATEGORY_COLORS: Record<ServiceCategory, string> = {
  Compute: "#ED7100",
  Storage: "#7AA116",
  Database: "#C925D1",
  Networking: "#8C4FFF",
  Security: "#DD344C",
  "Application Integration": "#E7157B",
  Management: "#E7157B",
  Analytics: "#8C4FFF",
};

export const CATEGORY_ICONS: Record<ServiceCategory, LucideIcon> = {
  Compute: Cpu,
  Storage: HardDrive,
  Database: Database,
  Networking: Network,
  Security: Shield,
  "Application Integration": Workflow,
  Management: Gauge,
  Analytics: ChartColumn,
};

const SERVICE_ICONS: Record<string, LucideIcon> = {
  s3: Archive,
  sqs: Inbox,
  sns: Megaphone,
  dynamodb: Table2,
  lambda: Lambda,
  apigateway: Waypoints,
  apigatewayv2: Waypoints,
  events: Radio,
  logs: ScrollText,
  iam: ShieldCheck,
};

/** Category of the well known services, used when only a service id is known (graphs, logs). */
const SERVICE_CATEGORIES: Record<string, ServiceCategory> = {
  s3: "Storage",
  sqs: "Application Integration",
  sns: "Application Integration",
  dynamodb: "Database",
  lambda: "Compute",
  apigateway: "Networking",
  apigatewayv2: "Networking",
  events: "Application Integration",
  logs: "Management",
  iam: "Security",
};

/** Short display names for well known services, used when the service registry is not loaded. */
export const SERVICE_SHORT_NAMES: Record<string, string> = {
  s3: "S3",
  sqs: "SQS",
  sns: "SNS",
  dynamodb: "DynamoDB",
  lambda: "Lambda",
  apigateway: "API Gateway",
  apigatewayv2: "API Gateway V2",
  events: "EventBridge",
  logs: "CloudWatch Logs",
  iam: "IAM",
};

export function serviceColor(serviceId: string, category?: ServiceCategory): string {
  const cat = category ?? SERVICE_CATEGORIES[serviceId];
  return cat ? CATEGORY_COLORS[cat] : "#5f6b7a";
}

/** Square AWS-style service icon (white glyph on the category color). */
export function ServiceIcon({
  service,
  category,
  size = "md",
  className,
}: {
  service: string;
  category?: ServiceCategory;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const cat = category ?? SERVICE_CATEGORIES[service];
  const Icon = SERVICE_ICONS[service] ?? (cat ? CATEGORY_ICONS[cat] : Box);
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-md text-white",
        size === "sm" && "size-5 rounded",
        size === "md" && "size-8",
        size === "lg" && "size-11 rounded-lg",
        className,
      )}
      style={{ background: `linear-gradient(135deg, ${serviceColor(service, cat)}, ${serviceColor(service, cat)}d9)` }}
    >
      <Icon className={cn(size === "sm" && "size-3.5", size === "md" && "size-5", size === "lg" && "size-6")} strokeWidth={1.75} />
    </span>
  );
}
