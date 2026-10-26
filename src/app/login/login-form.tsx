"use client";

import { useState } from "react";
import { Eye, EyeOff, LockKeyhole, Mail } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/forms";
import { loginAction } from "./actions";

const inputClass =
  "block h-12 w-full rounded-lg border border-slate-300 bg-white pl-11 text-[15px] text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-primary-500 focus:ring-2 focus:ring-primary-500/25 focus:outline-none";

export function LoginForm() {
  const [showPassword, setShowPassword] = useState(false);
  return (
    <ActionForm action={loginAction} className="space-y-5">
      <div>
        <label htmlFor="email" className="block text-sm font-medium text-slate-700">
          E-mail address
        </label>
        <div className="relative mt-1.5">
          <Mail className="pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-slate-400" aria-hidden />
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            required
            autoFocus
            placeholder="name@company.com"
            className={`${inputClass} pr-3`}
          />
        </div>
      </div>
      <div>
        <label htmlFor="password" className="block text-sm font-medium text-slate-700">
          Password
        </label>
        <div className="relative mt-1.5">
          <LockKeyhole className="pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-slate-400" aria-hidden />
          <input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            required
            placeholder="Enter your password"
            className={`${inputClass} pr-12`}
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? "Hide password" : "Show password"}
            aria-pressed={showPassword}
            aria-controls="password"
            className="absolute top-1/2 right-1.5 flex size-9 -translate-y-1/2 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
          >
            {showPassword ? <EyeOff className="size-5" aria-hidden /> : <Eye className="size-5" aria-hidden />}
          </button>
        </div>
      </div>
      <div className="pt-1 [&>button]:h-12 [&>button]:w-full [&>button]:text-base [&>button]:font-semibold [&>button]:shadow-md [&>button]:shadow-primary-600/25">
        <SubmitButton>Sign in</SubmitButton>
      </div>
    </ActionForm>
  );
}
