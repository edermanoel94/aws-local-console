"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Activity, Layers, ScrollText } from "lucide-react";
import type { Resource } from "@/types/api";
import { JsonView } from "@/components/ui";
import { ServiceIcon, SERVICE_SHORT_NAMES } from "@/components/aws/service-icon";
import { formatDateTime } from "@/lib/format";

/** Resource detail (drawer body): identity, tags, attributes JSON and related navigation. */
export function ResourceDetail({ resource: r }: { resource: Resource }) {
  return (
    <div className="flex flex-col gap-5 text-sm">
      <div className="flex items-center gap-3">
        <ServiceIcon service={r.service} size="lg" />
        <div className="min-w-0">
          <p className="truncate text-base font-bold">{r.name}</p>
          <p className="text-aws-muted">
            {SERVICE_SHORT_NAMES[r.service] ?? r.service} {r.type}
          </p>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-3">
        <Item label="Service">{SERVICE_SHORT_NAMES[r.service] ?? r.service}</Item>
        <Item label="Type">{r.type}</Item>
        <Item label="Region">{r.region}</Item>
        <Item label="Created">{formatDateTime(r.createdAt)}</Item>
        <div className="col-span-2">
          <dt className="text-xs text-aws-muted">ARN</dt>
          <dd className="mt-0.5 font-mono text-[12px] break-all">{r.arn}</dd>
        </div>
      </dl>

      <div className="flex flex-wrap gap-2">
        <QuickLink href={`/services/${r.service}?tab=resources`} icon={<Layers className="size-3.5" />}>
          Open in {SERVICE_SHORT_NAMES[r.service] ?? r.service} console
        </QuickLink>
        <QuickLink href={`/events?q=${encodeURIComponent(r.name)}`} icon={<Activity className="size-3.5" />}>
          Events
        </QuickLink>
        <QuickLink href={`/logs?q=${encodeURIComponent(r.name)}`} icon={<ScrollText className="size-3.5" />}>
          Logs
        </QuickLink>
      </div>

      <section>
        <h3 className="mb-2 font-bold">Tags ({r.tags.length})</h3>
        {r.tags.length === 0 ? (
          <p className="text-aws-muted">No tags.</p>
        ) : (
          <table className="w-full overflow-hidden rounded-lg border border-aws-border text-[13px]">
            <thead className="bg-aws-panel/60">
              <tr>
                <th className="px-3 py-1.5 text-left font-bold">Key</th>
                <th className="px-3 py-1.5 text-left font-bold">Value</th>
              </tr>
            </thead>
            <tbody>
              {r.tags.map((t) => (
                <tr key={t.key} className="border-t border-aws-border">
                  <td className="px-3 py-1.5 font-mono break-all">{t.key}</td>
                  <td className="px-3 py-1.5 font-mono break-all">{t.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h3 className="mb-2 font-bold">Attributes</h3>
        <JsonView value={r.attributes} label="Resource attributes" />
      </section>
    </div>
  );
}

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-aws-muted">{label}</dt>
      <dd className="mt-0.5 truncate">{children}</dd>
    </div>
  );
}

function QuickLink({ href, icon, children }: { href: string; icon: ReactNode; children: ReactNode }) {
  return (
    <Link href={href} className="inline-flex h-7 items-center gap-1.5 rounded-full border border-aws-border-strong px-3 text-xs font-bold text-aws-ink no-underline hover:bg-aws-panel">
      <span className="text-aws-muted" aria-hidden>
        {icon}
      </span>
      {children}
    </Link>
  );
}
