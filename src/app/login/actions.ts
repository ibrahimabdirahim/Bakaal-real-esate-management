"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { login, logout } from "@/server/auth/session";
import { clientAddress, recordSignInFailure, signInBlocked } from "@/server/auth/rate-limit";
import type { ActionState } from "@/server/action";

export async function loginAction(_: ActionState, form: FormData): Promise<ActionState> {
  const email = String(form.get("email") ?? "");
  const password = String(form.get("password") ?? "");
  if (!email || !password) return { error: "Enter your e-mail and password." };
  // Too many failed sign-ins from this network address: refuse before checking anything (no account is touched).
  const address = clientAddress(await headers());
  if (signInBlocked(address)) return { error: "Too many failed sign-ins from this network. Wait 15 minutes, then try again." };
  const result = await login(email, password);
  if (!result.ok) {
    recordSignInFailure(address);
    return { error: result.error };
  }
  redirect("/");
}

export async function logoutAction() {
  await logout();
  redirect("/login");
}
