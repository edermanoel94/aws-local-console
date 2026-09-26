"use client";

import { Tabs } from "@/components/ui";
import { ConsoleRoot } from "../_shared/layout";
import { useConsoleNav } from "../_shared/nav";
import { BusList, BusDetail, CreateBusPage } from "./buses";
import { RuleList } from "./rule-list";
import { CreateRulePage } from "./create-rule";
import { RuleDetail } from "./rule-detail";
import { SendEventsPage } from "./send-events";

const SECTIONS = [
  { value: "rules", label: "Rules" },
  { value: "buses", label: "Event buses" },
] as const;

function EventsRouter() {
  const { view, resource, navigate } = useConsoleNav();
  if (view === "create-rule") return <CreateRulePage />;
  if (view === "create-bus") return <CreateBusPage />;
  if (view === "send") return <SendEventsPage />;
  if (view === "bus" && resource) return <BusDetail key={resource} busName={resource} />;
  if (resource) return <RuleDetail key={resource} ruleName={resource} />;
  const section = view === "buses" ? "buses" : "rules";
  return (
    <>
      <Tabs label="EventBridge sections" tabs={[...SECTIONS]} value={section} onChange={(v) => navigate({ view: v === "rules" ? null : v })} />
      {section === "rules" ? <RuleList /> : <BusList />}
    </>
  );
}

export default function EventsConsole() {
  return (
    <ConsoleRoot>
      <EventsRouter />
    </ConsoleRoot>
  );
}
