import dynamic from "next/dynamic";
import { createElement } from "react";
import { Loading } from "@/components/ui/states";
import type { ServiceConsole } from "./registry";

const loading = () => createElement(Loading, { label: "Loading console" });

// Map of service id -> console component, each lazy loaded in its own chunk.
export const serviceConsoles: Record<string, ServiceConsole> = {
  s3: dynamic(() => import("./s3/s3-console"), { loading }),
  sqs: dynamic(() => import("./sqs/sqs-console"), { loading }),
  sns: dynamic(() => import("./sns/sns-console"), { loading }),
  dynamodb: dynamic(() => import("./dynamodb/dynamodb-console"), { loading }),
  lambda: dynamic(() => import("./lambda/lambda-console"), { loading }),
  apigateway: dynamic(() => import("./apigateway/apigateway-console"), { loading }),
  events: dynamic(() => import("./events/events-console"), { loading }),
};
