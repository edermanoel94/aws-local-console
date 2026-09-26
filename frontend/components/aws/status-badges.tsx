import { Badge } from "@/components/ui/badge";
import type { Coverage, ExecutionStatus } from "@/types/api";

export function ExecutionStatusBadge({ status }: { status: ExecutionStatus }) {
  return <Badge tone={status === "success" ? "green" : "red"}>{status === "success" ? "Success" : "Error"}</Badge>;
}

export function HttpStatusText({ code }: { code: number }) {
  const tone = code === 0 ? "text-aws-muted" : code < 300 ? "text-aws-green" : code < 500 ? "text-aws-orange-dark" : "text-aws-red";
  return <span className={`font-mono font-bold ${tone}`}>{code === 0 ? "-" : code}</span>;
}

const COVERAGE_TONE = { supported: "green", unsupported: "red", untested: "gray" } as const;
const COVERAGE_LABEL = { supported: "Supported", unsupported: "Unsupported", untested: "Untested" } as const;

export function CoverageBadge({ coverage }: { coverage: Coverage }) {
  return <Badge tone={COVERAGE_TONE[coverage]}>{COVERAGE_LABEL[coverage]}</Badge>;
}

export function AvailabilityBadge({ available }: { available: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-bold ${available ? "text-aws-green" : "text-aws-muted"}`}>
      <span className={`size-2 rounded-full ${available ? "bg-aws-green" : "bg-aws-border-strong"}`} aria-hidden />
      {available ? "Available" : "Not running"}
    </span>
  );
}

/** Stacked bar showing supported / unsupported / untested operation counts. `compact` renders a one-line variant. */
export function CoverageBar({
  coverage,
  className,
  compact,
}: {
  coverage: { supported: number; unsupported: number; untested: number };
  className?: string;
  compact?: boolean;
}) {
  const total = coverage.supported + coverage.unsupported + coverage.untested || 1;
  const pct = (n: number) => `${(n / total) * 100}%`;
  const bar = (
    <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-aws-border" aria-hidden>
      <span className="bg-aws-green" style={{ width: pct(coverage.supported) }} />
      <span className="bg-aws-red" style={{ width: pct(coverage.unsupported) }} />
    </div>
  );
  if (compact) {
    return (
      <div className={`flex items-center gap-2 ${className ?? ""}`} title={`${coverage.supported} supported, ${coverage.unsupported} unsupported, ${coverage.untested} untested`}>
        <span className="w-24 shrink-0">{bar}</span>
        <span className="text-xs whitespace-nowrap text-aws-muted">
          <span className="font-bold text-aws-green">{coverage.supported}</span> supported
          {coverage.unsupported > 0 && (
            <>
              {" · "}
              <span className="font-bold text-aws-red">{coverage.unsupported}</span> unsupported
            </>
          )}
        </span>
      </div>
    );
  }
  return (
    <div className={className}>
      {bar}
      <p className="mt-1 text-xs text-aws-muted">
        <span className="font-bold text-aws-green">{coverage.supported}</span> supported
        {" · "}
        <span className="font-bold text-aws-red">{coverage.unsupported}</span> unsupported
        {" · "}
        {coverage.untested} untested
      </p>
    </div>
  );
}
