import Link from "next/link";
import { SearchX } from "lucide-react";

export default function NotFound() {
  return (
    <div className="mx-auto mt-10 max-w-lg rounded-xl border border-slate-200 bg-white p-6 text-center shadow-[var(--shadow-card)]">
      <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-slate-100 text-slate-500">
        <SearchX className="size-6" aria-hidden />
      </span>
      <h1 className="mt-4 text-lg font-semibold text-navy-900">Record not found</h1>
      <p className="mt-1 text-sm text-slate-600">It may not exist, or your role may not include access to it.</p>
      <Link href="/" className="mt-5 inline-block text-sm font-medium text-primary-600 hover:underline">
        Back to the dashboard
      </Link>
    </div>
  );
}
