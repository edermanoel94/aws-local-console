"use client";

import { ConsoleRoot } from "../_shared/layout";
import { useConsoleNav } from "../_shared/nav";
import { QueueList } from "./queue-list";
import { CreateQueuePage } from "./create-queue";
import { QueueDetail } from "./queue-detail";

function SqsRouter() {
  const { view, resource } = useConsoleNav();
  if (view === "create") return <CreateQueuePage />;
  if (resource) return <QueueDetail key={resource} queueName={resource} />;
  return <QueueList />;
}

export default function SqsConsole() {
  return (
    <ConsoleRoot>
      <SqsRouter />
    </ConsoleRoot>
  );
}
