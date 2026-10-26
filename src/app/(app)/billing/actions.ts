"use server";

import { runAction, type ActionState } from "@/server/action";
import { issueBilling } from "@/server/services/billing";
import { formatMonth } from "@/lib/dates";

export async function issueBillingAction(periodStart: string, _: ActionState): Promise<ActionState> {
  return runAction(async (actor) => {
    const { preview } = await issueBilling(actor, periodStart);
    return `Issued ${preview.invoices.length} invoice(s) for ${formatMonth(periodStart)}. ${preview.exceptions.length} item(s) remain held for review.`;
  });
}
