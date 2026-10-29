import Link from "next/link";
import { connection } from "next/server";
import { SearchX } from "lucide-react";
import { BrandLogo } from "@/components/brand";

// Addresses that match no page. Rendered per request (not prebuilt), so it carries the
// Content-Security-Policy nonce like every page.
export default async function NotFound() {
  await connection();
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-surface px-4">
      <BrandLogo width={110} />
      <div className="mt-6 max-w-md rounded-xl border border-slate-200 bg-white p-6 text-center shadow-[var(--shadow-card)]">
        <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-slate-100 text-slate-500">
          <SearchX className="size-6" aria-hidden />
        </span>
        <h1 className="mt-4 text-lg font-semibold text-navy-900">Page not found</h1>
        <p className="mt-1 text-sm text-slate-600">This address does not exist.</p>
        <Link href="/" className="mt-5 inline-block text-sm font-medium text-primary-600 hover:underline">
          Back to the dashboard
        </Link>
      </div>
    </div>
  );
}
