"use client";

import { ConsoleRoot } from "../_shared/layout";
import { useConsoleNav } from "../_shared/nav";
import { TableList } from "./table-list";
import { CreateTablePage } from "./create-table";
import { TableDetail } from "./table-detail";

function DynamoRouter() {
  const { view, resource } = useConsoleNav();
  if (view === "create") return <CreateTablePage />;
  if (resource) return <TableDetail key={resource} tableName={resource} />;
  return <TableList />;
}

export default function DynamoDbConsole() {
  return (
    <ConsoleRoot>
      <DynamoRouter />
    </ConsoleRoot>
  );
}
