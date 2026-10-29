/** Shown while a page's figures load (streamed after the sign-in and permission checks have passed). */
export function PageSkeleton({ title }: { title: string }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className="animate-pulse">
      <h1 className="text-2xl font-bold text-navy-900">{title}</h1>
      <span className="sr-only">Loading…</span>
      <div className="mt-2 h-4 w-80 max-w-full rounded-md bg-slate-100" />
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-24 rounded-[var(--radius-card)] border border-line bg-white" />
        ))}
      </div>
      <div className="mt-6 h-64 rounded-[var(--radius-card)] border border-line bg-white" />
    </div>
  );
}
