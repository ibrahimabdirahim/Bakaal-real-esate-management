import Link from "next/link";
import { FilePlus2, Wallet, X } from "lucide-react";
import type { Actor } from "@/server/auth/actor";
import { can } from "@/server/auth/permissions";
import { db } from "@/server/db";
import { accountBalance } from "@/server/services/finance";
import { ButtonLink, Money } from "@/components/ui";

/**
 * Billing & Payments filtered to one account (?partyId=): its balance, as everywhere (accountBalance),
 * and the two actions for it. Opened from the account register's outstanding balance.
 */
export async function AccountBanner({ actor, partyId, clearHref }: { actor: Actor; partyId: string; clearHref: string }) {
  const party = await db.party.findUnique({ where: { id: partyId }, select: { id: true, displayName: true, archivedAt: true } });
  if (!party) return null;
  const balance = can(actor.role, "invoices.view") ? await accountBalance(actor, partyId) : null;
  return (
    <section aria-label="Selected account" className="mb-6 flex flex-wrap items-center gap-x-8 gap-y-3 rounded-[var(--radius-card)] border border-primary-100 bg-primary-50/60 px-5 py-4" data-account-banner={party.id}>
      <div className="min-w-0">
        <p className="text-xs text-muted">Account</p>
        <Link href={`/accounts/${party.id}`} className="font-semibold text-navy-900 hover:underline">{party.displayName}</Link>
      </div>
      {balance && (
        <>
          <div>
            <p className="text-xs text-muted">Outstanding</p>
            <p className="font-semibold text-navy-900 tabular-nums" data-outstanding><Money cents={balance.outstanding} /></p>
          </div>
          <div>
            <p className="text-xs text-muted">Unallocated payments</p>
            <p className="font-semibold text-emerald-700 tabular-nums"><Money cents={balance.unallocated} /></p>
          </div>
          <div>
            <p className="text-xs text-muted">Open invoices</p>
            <p className="font-semibold text-navy-900 tabular-nums">{balance.openInvoices.length}</p>
          </div>
        </>
      )}
      <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
        {!party.archivedAt && can(actor.role, "invoices.create_manual") && <ButtonLink variant="secondary" href={`/invoices/new?partyId=${party.id}`} icon={FilePlus2}>Create invoice</ButtonLink>}
        {!party.archivedAt && can(actor.role, "payments.record") && <ButtonLink href={`/payments/new?partyId=${party.id}`} icon={Wallet}>Record payment</ButtonLink>}
        <Link href={clearHref} className="inline-flex items-center gap-1 px-2 py-2 text-sm text-muted hover:text-ink"><X className="size-4" aria-hidden /> All accounts</Link>
      </div>
    </section>
  );
}
