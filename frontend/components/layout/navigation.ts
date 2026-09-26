import {
  Activity,
  Boxes,
  LayoutDashboard,
  Layers,
  Network,
  ScrollText,
  Settings,
  SquareTerminal,
  Braces,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  description: string;
}

/** Main navigation (sidebar order). Also used as "Pages" in the global search. */
export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, description: "Environment overview" },
  { href: "/services", label: "Services", icon: Layers, description: "Browse services by category" },
  { href: "/resources", label: "Resources", icon: Boxes, description: "Resource Explorer across services" },
  { href: "/api-explorer", label: "API Explorer", icon: Braces, description: "Execute any AWS operation" },
  { href: "/architecture", label: "Architecture", icon: Network, description: "Resource relationship graph" },
  { href: "/events", label: "Events", icon: Activity, description: "Resource lifecycle events" },
  { href: "/logs", label: "Logs", icon: ScrollText, description: "Audit log and request inspector" },
  { href: "/cli", label: "CLI", icon: SquareTerminal, description: "AWS CLI terminal" },
  { href: "/settings", label: "Settings", icon: Settings, description: "Endpoint, region and preferences" },
];

export function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
