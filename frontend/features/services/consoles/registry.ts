import type { ComponentType } from "react";

/**
 * Service consoles rendered inside the "Resources" tab of /services/[service].
 * Owned by the service-consoles work stream; the page only looks up this map.
 * Each console receives the service id and must be a client component.
 */
export interface ServiceConsoleProps {
  serviceId: string;
}

export type ServiceConsole = ComponentType<ServiceConsoleProps>;

// Filled in by features/services/consoles/index.ts (lazy loaded per service).
export { serviceConsoles } from "./index";
