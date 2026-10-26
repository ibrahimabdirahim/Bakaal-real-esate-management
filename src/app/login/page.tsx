import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Building2, ShieldCheck, Wallet } from "lucide-react";
import { getActor } from "@/server/auth/session";
import { BrandLogo } from "@/components/brand";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

const POINTS = [
  { icon: Building2, title: "Property portfolio", text: "Units, tenants, owners and agreements in one place" },
  { icon: Wallet, title: "Billing & payments", text: "Verified payments and receipts with full history" },
  { icon: ShieldCheck, title: "Secure by design", text: "Role-based access and a tamper-proof audit trail" },
];

/** Decorative city skyline drawn along the bottom of the branding panel. */
function Skyline({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 600 260" preserveAspectRatio="xMidYMax slice" className={className} aria-hidden>
      <g fill="currentColor">
        <rect x="0" y="150" width="46" height="110" />
        <rect x="52" y="110" width="38" height="150" />
        <rect x="96" y="60" width="54" height="200" />
        <rect x="118" y="36" width="10" height="24" />
        <rect x="156" y="130" width="40" height="130" />
        <rect x="202" y="88" width="48" height="172" />
        <rect x="256" y="20" width="62" height="240" />
        <rect x="282" y="0" width="8" height="20" />
        <rect x="324" y="100" width="44" height="160" />
        <rect x="374" y="70" width="56" height="190" />
        <rect x="436" y="140" width="38" height="120" />
        <rect x="480" y="96" width="50" height="164" />
        <rect x="536" y="160" width="64" height="100" />
      </g>
      <g fill="#0a2c4c" opacity="0.55">
        {[96, 202, 256, 374, 480].flatMap((x, b) =>
          Array.from({ length: 9 }, (_, r) => (
            <rect key={`${b}-${r}`} x={x + 8} y={80 + b * 6 + r * 18} width={x === 256 ? 46 : 32} height="6" rx="1" />
          )),
        )}
      </g>
    </svg>
  );
}

export default async function LoginPage() {
  if (await getActor()) redirect("/");
  return (
    <div className="flex min-h-screen flex-col bg-surface lg:flex-row">
      {/* Branding panel: a compact header on phones and tablets, a full side panel on desktops. */}
      <aside className="relative overflow-hidden bg-gradient-to-br from-navy-800 via-navy-900 to-navy-950 text-white lg:flex lg:w-[46%] lg:max-w-2xl lg:flex-col">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{ backgroundImage: "linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)", backgroundSize: "44px 44px" }}
          aria-hidden
        />
        <div className="pointer-events-none absolute -top-32 -right-32 size-96 rounded-full bg-primary-600/20 blur-3xl" aria-hidden />
        <Skyline className="pointer-events-none absolute inset-x-0 bottom-0 h-28 w-full text-white/[0.06] sm:h-36 lg:h-72" />

        <div className="relative flex items-center gap-4 px-6 py-6 sm:px-10 sm:py-8 lg:px-12 lg:pt-12">
          <BrandLogo width={88} priority className="h-auto shadow-lg shadow-black/20 ring-1 ring-white/10 sm:w-[104px] lg:w-[120px]" />
          <div>
            <p className="text-2xl font-extrabold tracking-[0.08em] sm:text-3xl">BAKAAL</p>
            <p className="text-[10px] font-medium tracking-[0.22em] text-slate-300 uppercase sm:text-xs">Real Estate Management</p>
          </div>
        </div>

        <div className="relative hidden flex-1 flex-col justify-center px-12 pb-40 lg:flex">
          <p className="text-xs font-semibold tracking-[0.2em] text-primary-100/80 uppercase">Staff workspace</p>
          <h2 className="mt-3 max-w-md text-4xl leading-tight font-semibold">Manage every Bakaal property with confidence.</h2>
          <ul className="mt-10 space-y-5">
            {POINTS.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex items-start gap-4">
                <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-white/10 text-primary-100 ring-1 ring-white/15">
                  <Icon className="size-5" aria-hidden />
                </span>
                <div>
                  <p className="font-semibold">{title}</p>
                  <p className="text-sm text-slate-300">{text}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative hidden px-12 pb-10 text-xs text-slate-400 lg:block">Authorised staff only. Tenants and owners do not have accounts in this system.</p>
      </aside>

      <main className="flex flex-1 items-start justify-center px-4 py-10 sm:items-center sm:px-8 sm:py-16">
        <div className="w-full max-w-md">
          <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-xl shadow-navy-900/5 sm:p-10">
            <h1 className="text-2xl font-bold text-navy-900">Welcome back</h1>
            <p className="mt-1.5 text-sm text-slate-500">Sign in to the Bakaal management workspace.</p>
            <div className="mt-8">
              <LoginForm />
            </div>
          </div>
          <p className="mt-6 text-center text-sm text-slate-500">Forgot your password? Ask a system administrator to reset it.</p>
          <p className="mt-2 text-center text-xs text-slate-400 lg:hidden">Authorised staff only.</p>
        </div>
      </main>
    </div>
  );
}
