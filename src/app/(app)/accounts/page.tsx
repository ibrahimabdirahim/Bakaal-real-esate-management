import Link from "next/link";
import { formatMoney } from "@/lib/money";
import { Plus, Users } from "lucide-react";
import { RowActions, type RowAction } from "@/components/row-actions";
import type { Actor } from "@/server/auth/actor";
import { requirePage } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { listParties, type AccountType } from "@/server/services/property";
import { Badge, ButtonLink, Card, Notice, FilterBar, FilterInput, FilterPills, FilterSubmit, PageHeader, Pagination, Table, Td } from "@/components/ui";
import { paginate, queryWithoutPage } from "@/lib/paginate";
import { deleteAction } from "@/components/row-action-items";
import { deletePartyAction } from "./actions";

export const metadata = { title: "Accounts" };

export default async function AccountsPage({ searchParams }: PageProps<"/accounts">) {
  const actor = await requirePage("accounts.view");
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  const showArchived = sp.archived === "1";
  const typeFilter = (typeof sp.type === "string" && ["TENANT", "OWNER", "MANAGED", "NONE"].includes(sp.type) ? sp.type : "") as AccountType | "NONE" | "";
  // One list; the categories below only filter it (each account's category comes from its agreements).
  const everyone = await listParties(actor, q || undefined, { includeArchived: showArchived });
  const inCategory = (t: AccountType | "NONE" | "") => (t === "" ? everyone : t === "NONE" ? everyone.filter((r) => r.types.length === 0) : everyone.filter((r) => r.types.includes(t)));
  const { items: parties, ...pg } = paginate(inCategory(typeFilter), sp.page);
  const withType = (t: string) => {
    const qs = new URLSearchParams(Object.entries({ type: t, q, archived: showArchived ? "1" : "" }).filter(([, v]) => v));
    return `/accounts${qs.size ? `?${qs}` : ""}`;
  };
  const categories: { type: AccountType | "NONE" | ""; label: string }[] = [
    { type: "", label: "All accounts" },
    { type: "TENANT", label: "Rent-Paying Tenants" },
    { type: "OWNER", label: "Purchased Unit Owners" },
    { type: "MANAGED", label: "Purchased Units Managed by BAKAAL" },
    { type: "NONE", label: "No agreement in force" },
  ];
  const showBalance = can(actor.role, "invoices.view");

  return (
    <>
      <PageHeader
        title="Account register"
        icon={Users}
        description="All accounts in one list: rent-paying tenants, purchased-unit owners and owners whose unit BAKAAL manages. The category comes from each account's agreements; accounts are records, not logins."
        actions={can(actor.role, "accounts.manage") ? <ButtonLink href="/accounts/new" icon={Plus}>Add account</ButtonLink> : null}
      />
      {sp.deleted === "1" && (
        <div className="mb-6">
          <Notice tone="green">Account deleted permanently. It has been removed from the register; the deletion is recorded in the audit log.</Notice>
        </div>
      )}
      <FilterPills label="Account category" items={categories.map((c) => ({ href: withType(c.type), label: c.label, count: inCategory(c.type).length, current: typeFilter === c.type }))} />
      <Card>
        <FilterBar>
          {typeFilter && <input type="hidden" name="type" value={typeFilter} />}
          <FilterInput label="Search" name="q" defaultValue={q} placeholder="Name, phone or e-mail" />
          <label className="flex items-center gap-2 pb-2 text-sm text-slate-700">
            <input type="checkbox" name="archived" value="1" defaultChecked={showArchived} /> Show archived
          </label>
          <FilterSubmit />
        </FilterBar>
        <Table
          head={["Name", "Account type", "Units", "Status / agreement", "Contact", ...(showBalance ? ["Outstanding"] : []), <span key="actions" className="sr-only">Actions</span>]}
          empty={q || typeFilter ? "No accounts match these filters." : "No accounts yet."}
        >
          {parties.map((p) => (
            <tr key={p.id}>
              <Td wrap className="max-w-56">
                <Link href={`/accounts/${p.id}`} className="font-medium break-words text-primary-600 hover:underline">{p.displayName}</Link>
              </Td>
              <Td>{p.category}</Td>
              <Td>{p.units.join(", ") || "—"}</Td>
              <Td>
                {p.archived ? <Badge tone="slate">Archived</Badge> : <Badge tone="green">Active</Badge>}
                <span className="mt-0.5 block text-xs text-muted">{`Agreement: ${p.agreementStatus.toLowerCase()}`}</span>
              </Td>
              <Td className="text-slate-500">{[p.phone, p.email].filter(Boolean).join(" · ") || "—"}</Td>
              {showBalance && p.balance && (
                <Td>
                  {/* Opens Billing & Payments for this account: its invoices, payments and balance. */}
                  <Link href={`/invoices?partyId=${p.id}`} className={`tabular-nums hover:underline ${p.balance.outstanding > 0 ? "font-medium text-primary-700" : "text-slate-600"}`} aria-label={`Outstanding ${formatMoney(p.balance.outstanding)} for ${p.displayName}: open in Billing & Payments`}>
                    {formatMoney(p.balance.outstanding)}
                  </Link>
                  {p.balance.unallocated > 0 && <span className="block text-xs text-emerald-700">{`${formatMoney(p.balance.unallocated)} unallocated`}</span>}
                </Td>
              )}
              <Td className="w-px text-right"><RowActions label={`Actions for ${p.displayName}`} items={accountActions(actor, p)} /></Td>
            </tr>
          ))}
        </Table>
        <Pagination {...pg} path="/accounts" query={queryWithoutPage(sp)} />
      </Card>
    </>
  );
}

/**
 * What can be done with an account from the register (F50). Accounts with agreements, invoices or
 * payments are kept for their history: they are neither archived nor deleted (F25). Archive and
 * Delete open the account page, where the full check runs again and a reason or confirmation is required.
 */
function accountActions(actor: Actor, p: { id: string; displayName: string; archived: boolean; history: number }): RowAction[] {
  const items: RowAction[] = [{ label: "View account", href: `/accounts/${p.id}` }];
  if (can(actor.role, "accounts.manage")) {
    items.push(p.archived ? { label: "Edit account", unavailable: "Archived accounts are kept as they were and cannot be edited." } : { label: "Edit account", href: `/accounts/${p.id}#edit` });
    if (can(actor.role, "invoices.view")) items.push({ label: "Invoices & payments", href: `/invoices?partyId=${p.id}` });
    const kept = "This account has agreements, invoices or payments, so it is kept for the record; it cannot be archived or deleted.";
    if (p.history > 0) {
      items.push({ label: "Archive or delete", unavailable: kept });
    } else {
      if (!p.archived) items.push({ label: "Archive account", href: `/accounts/${p.id}#archive` });
      if (can(actor.role, "accounts.delete")) items.push(deleteAction("Delete account", deletePartyAction.bind(null, p.id), "account"));
    }
  }
  return items;
}
