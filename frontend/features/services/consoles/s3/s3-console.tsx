"use client";

import { ConsoleRoot } from "../_shared/layout";
import { useConsoleNav } from "../_shared/nav";
import { BucketList } from "./bucket-list";
import { CreateBucketPage } from "./create-bucket";
import { BucketDetail } from "./bucket-detail";

function S3Router() {
  const { view, resource } = useConsoleNav();
  if (view === "create") return <CreateBucketPage />;
  if (resource) return <BucketDetail key={resource} bucket={resource} />;
  return <BucketList />;
}

export default function S3Console() {
  return (
    <ConsoleRoot>
      <S3Router />
    </ConsoleRoot>
  );
}
