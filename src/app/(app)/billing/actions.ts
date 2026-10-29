"use server";

import { finish, runAction, type ActionState } from "@/server/action";
import { issueBilling, type BillingScope } from "@/server/services/billing";

/**
 * Issues the previewed billing. The server recalculates everything (the page's figures are not
 * trusted) and then shows the run's report; a refusal (nothing new, permission) stays on the page.
 */
export async function issueBillingAction(periodStart: string, scope: BillingScope, _: ActionState): Promise<ActionState> {
  let runId = "";
  const state = await runAction(async (actor) => {
    runId = (await issueBilling(actor, periodStart, scope)).run!.id;
  });
  if (state?.error || !runId) return state;
  finish(`/billing?run=${runId}&month=${periodStart}`);
}
