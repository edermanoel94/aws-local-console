import type { ServiceConsole } from "./registry";

// Map of service id -> console component. Add one entry per service console, e.g.
//   s3: dynamic(() => import("./s3/s3-console")),
export const serviceConsoles: Record<string, ServiceConsole> = {};
