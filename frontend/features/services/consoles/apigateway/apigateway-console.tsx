"use client";

import { ConsoleRoot } from "../_shared/layout";
import { useConsoleNav } from "../_shared/nav";
import { ApiList } from "./api-list";
import { CreateApiPage } from "./create-api";
import { ApiDetail } from "./api-detail";

function ApiGatewayRouter() {
  const { view, resource } = useConsoleNav();
  if (view === "create") return <CreateApiPage />;
  if (resource) return <ApiDetail key={resource} apiId={resource} />;
  return <ApiList />;
}

export default function ApiGatewayConsole() {
  return (
    <ConsoleRoot>
      <ApiGatewayRouter />
    </ConsoleRoot>
  );
}
