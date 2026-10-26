import { getActor } from "@/server/auth/session";
import { PermissionError } from "@/server/auth/actor";
import { accountContext } from "@/server/services/property";
import { accountBalance } from "@/server/services/finance";
import { can } from "@/server/auth/permissions";
import { isISODate, todayISO } from "@/lib/dates";

// Read-only: an account's units, agreements and agreed terms on a date (?on=YYYY-MM-DD, default today),
// for forms that fill in the unit and show the rent. Permissions are checked by accountContext.
export async function GET(request: Request, ctx: RouteContext<"/api/accounts/[id]/context">) {
  const actor = await getActor();
  if (!actor) return Response.json({ error: "Your session has ended. Please sign in again." }, { status: 401 });
  const { id } = await ctx.params;
  const on = new URL(request.url).searchParams.get("on") ?? "";
  try {
    const result = await accountContext(actor, id, isISODate(on) ? on : todayISO());
    if (!result) return Response.json({ error: "Account not found." }, { status: 404 });
    // The balance as everywhere else (accountBalance), for roles that may see invoices.
    const balance = can(actor.role, "invoices.view") ? await accountBalance(actor, id) : null;
    return Response.json({ ...result, balance }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof PermissionError) return Response.json({ error: "You do not have permission to see this account's agreements." }, { status: 403 });
    console.error("Account lookup failed", e);
    return Response.json({ error: "The account's details could not be loaded." }, { status: 500 });
  }
}
