import Link from "next/link";
import type { RegistrationProgress as Progress } from "@/lib/capacity";
import { Card, Notice } from "@/components/ui";

function Figure({ label, value, href, hint }: { label: string; value: React.ReactNode; href?: string; hint?: string }) {
  const body = (
    <>
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className="text-2xl font-bold tracking-tight text-ink tabular-nums">{value}</p>
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </>
  );
  return href ? (
    <Link href={href} className="block rounded-lg border border-line px-4 py-3 transition hover:border-primary-500 hover:bg-surface">
      {body}
    </Link>
  ) : (
    <div className="rounded-lg border border-line px-4 py-3">{body}</div>
  );
}

/**
 * Building capacity versus units entered in the register. Deliberately separate from
 * occupancy: a unit still to be registered is not "vacant", and a registered unit is
 * not "occupied" until an agreement applies.
 */
export function RegistrationProgress({
  progress,
  canConfigure,
  canAddUnits,
  className = "",
}: {
  progress: (Progress & { retired: number }) | null;
  canConfigure: boolean;
  canAddUnits: boolean;
  className?: string;
}) {
  if (!progress) return null;
  const settingsLink = canConfigure ? (
    <Link href="/settings" className="font-medium underline">
      set it in Settings
    </Link>
  ) : (
    "ask a system administrator to set it in Settings"
  );
  const retiredNote = progress.retired > 0 && (
    <p className="mt-3 text-xs text-muted">{progress.retired} retired unit(s) are not counted as registered.</p>
  );

  return (
    <Card
      title="Unit registration"
      description="Building capacity versus units entered in the unit register. This is not occupancy: registered units are vacant until an agreement applies."
      className={className}
    >
      {!progress.configured ? (
        <>
          <Notice>
            The building&apos;s total number of units has not been set, so the units still to register cannot be calculated. To track progress, {settingsLink}.{" "}
            {progress.registered} unit(s) registered so far.
          </Notice>
          {retiredNote}
        </>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Figure label="Total building units" value={progress.capacity} href={canConfigure ? "/settings" : undefined} hint="Physical capacity (Settings)" />
            <Figure label="Registered units" value={progress.registered} href="/units" hint="Units in use in the register" />
            <Figure
              label="Remaining to register"
              value={progress.remaining}
              href={canAddUnits && progress.remaining > 0 ? "/units/new" : undefined}
              hint={progress.overBy > 0 ? "Over capacity — see below" : progress.remaining > 0 ? "Not yet entered in the register" : "All units registered"}
            />
          </div>
          <div className="mt-4">
            <div
              className="flex h-2 overflow-hidden rounded-full bg-slate-100"
              role="progressbar"
              aria-label="Units registered"
              aria-valuemin={0}
              aria-valuemax={progress.capacity}
              aria-valuenow={progress.registered}
              aria-valuetext={`${progress.registered} of ${progress.capacity} units registered`}
            >
              <div className={progress.overBy > 0 ? "bg-accent-amber" : "bg-primary-600"} style={{ width: `${Math.min(progress.percent, 100)}%` }} />
            </div>
            <p className="mt-1.5 text-xs text-muted">{`${progress.registered} of ${progress.capacity} units registered (${progress.percent}%)`}</p>
          </div>
          {progress.overBy > 0 && (
            <div className="mt-4">
              <Notice>
                {progress.overBy} more unit(s) are registered than the building&apos;s total of {progress.capacity}. Check the register for duplicate or mistaken units and
                retire them on the unit&apos;s page, or, if the total is wrong, {canConfigure ? <Link href="/settings" className="font-medium underline">correct it in Settings</Link> : "ask a system administrator to correct it in Settings"}.
              </Notice>
            </div>
          )}
          {progress.remaining === 0 && progress.overBy === 0 && <p className="mt-3 text-sm font-medium text-emerald-700">All {progress.capacity} units are registered.</p>}
          {retiredNote}
        </>
      )}
    </Card>
  );
}
