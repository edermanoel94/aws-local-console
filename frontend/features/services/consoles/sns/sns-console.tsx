"use client";

import { ConsoleRoot } from "../_shared/layout";
import { useConsoleNav } from "../_shared/nav";
import { TopicList } from "./topic-list";
import { CreateTopicPage } from "./create-topic";
import { TopicDetail } from "./topic-detail";
import { PublishPage } from "./publish-page";
import { SubscriptionDetail } from "./subscription-detail";

function SnsRouter() {
  const { view, resource, item } = useConsoleNav();
  if (view === "create") return <CreateTopicPage />;
  if (resource && view === "subscription" && item) return <SubscriptionDetail key={item} topicName={resource} subscriptionArn={item} />;
  if (resource && view === "publish") return <PublishPage key={resource} topicName={resource} />;
  if (resource) return <TopicDetail key={resource} topicName={resource} />;
  return <TopicList />;
}

export default function SnsConsole() {
  return (
    <ConsoleRoot>
      <SnsRouter />
    </ConsoleRoot>
  );
}
