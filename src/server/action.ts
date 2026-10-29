import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { ZodError, type z } from "zod";
import { BusinessError, PermissionError, type Actor } from "@/server/auth/actor";
import { errorFields, log } from "@/server/log";
import { getActor } from "@/server/auth/session";
import { describeDbError } from "@/server/services/common";
import { formToObject } from "@/server/validation";

export type ActionState =
  | {
      error?: string;
      fieldErrors?: Record<string, string>;
      success?: string;
      /** One-time values to show the user, e.g. a temporary password. */
      reveal?: { label: string; value: string };
      /** Existing records that already use the submitted details (the save was refused). */
      duplicates?: { id: string; displayName: string; archived: boolean; reasons: string[] }[];
      /** The submitted values, shown again so the user does not have to retype them. */
      values?: Record<string, string>;
    }
  | undefined;

export function parseForm<T extends z.ZodType>(schema: T, form: FormData): z.output<T> {
  return schema.parse(formToObject(form));
}

/** Clears cached pages and navigates; use after a successful change. */
export function finish(path: string): never {
  revalidatePath("/", "layout");
  redirect(path);
}

/**
 * Runs a server action for a signed-in user and converts expected failures into form
 * state. Permission checks happen again inside every service function.
 */
export async function runAction(fn: (actor: Actor) => Promise<ActionState | string | void>): Promise<ActionState> {
  try {
    const actor = await getActor();
    if (!actor) return { error: "Your session has ended. Please sign in again." };
    const result = await fn(actor);
    revalidatePath("/", "layout");
    if (typeof result === "string") return { success: result };
    return result ?? { success: "Saved." };
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof ZodError) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of e.issues) {
        const key = String(issue.path[0] ?? "form");
        fieldErrors[key] ??= issue.message;
      }
      return { error: "Please correct the highlighted fields.", fieldErrors };
    }
    if (e instanceof BusinessError || e instanceof PermissionError) return { error: e.message };
    const known = describeDbError(e);
    if (known) return { error: known };
    log("error", "Unexpected action error", errorFields(e));
    return { error: "Something went wrong and the change was not saved. Please try again." };
  }
}
