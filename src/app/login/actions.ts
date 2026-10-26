"use server";

import { redirect } from "next/navigation";
import { login, logout } from "@/server/auth/session";
import type { ActionState } from "@/server/action";

export async function loginAction(_: ActionState, form: FormData): Promise<ActionState> {
  const email = String(form.get("email") ?? "");
  const password = String(form.get("password") ?? "");
  if (!email || !password) return { error: "Enter your e-mail and password." };
  const result = await login(email, password);
  if (!result.ok) return { error: result.error };
  redirect("/");
}

export async function logoutAction() {
  await logout();
  redirect("/login");
}
