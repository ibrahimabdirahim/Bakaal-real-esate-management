"use client";

import Link from "next/link";
import { useId, useRef } from "react";
import {
  Archive,
  ArrowRight,
  Bell,
  CalendarClock,
  ArrowRightLeft,
  CalendarX,
  Ban,
  Check,
  ChevronDown,
  CircleCheck,
  Copy,
  Download,
  Eye,
  FilePlus2,
  Pencil,
  Receipt,
  RotateCcw,
  Trash2,
  UserPlus,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/forms";
import type { ActionState } from "@/server/action";
import { DELETE_LABEL, DELETE_TITLE } from "@/lib/delete-confirm";

/**
 * One menu item: a link to the page or form that does it, a server action run here after a
 * confirmation (the server checks everything again), or an unavailable action with the reason.
 */
export type RowAction =
  | { label: string; href: string; tone?: "danger" }
  | { label: string; action: (state: ActionState, form: FormData) => Promise<ActionState>; confirm: string; tone?: "danger"; /** Hidden form values sent with it. */ fields?: Record<string, string>; /** A deletion: the shared "Delete record?" dialog (Cancel / Confirm Delete), F57. */ kind?: "delete"; /** The dialog's heading and confirm button, e.g. the shared approval (F61). */ confirmTitle?: string; confirmLabel?: string }
  | { label: string; unavailable: string };

// The same icon for the same kind of action on every list (by the label's first words).
const ICONS: [RegExp, LucideIcon][] = [
  [/^(view|open)\b/i, Eye],
  [/^(edit|update|correct with)\b/i, Pencil],
  [/^(delete|remove|archive or delete)\b/i, Trash2],
  [/^archive\b/i, Archive],
  [/^revers/i, RotateCcw],
  [/^(cancel|reject)\b/i, Ban],
  [/^(mark completed|mark done|done)\b/i, CircleCheck],
  [/^(approve|verify|review|decide|issue)\b/i, Check],
  [/^(record payment|record a payment)\b/i, Wallet],
  [/^allocate\b/i, ArrowRightLeft],
  [/^(record (a )?corrected|corrected copy)\b/i, Copy],
  [/^record linked expense\b/i, Receipt],
  [/^(new|create|record)\b/i, FilePlus2],
  [/^(assign|edit, assign)\b/i, UserPlus],
  [/^(download|export)\b/i, Download],
  [/^(generate|bulk create)\b/i, CalendarClock],
  [/^(prepare|send)\b/i, Bell],
  [/^retire\b/i, Archive],
  [/^return to use\b/i, RotateCcw],
  [/^end\b/i, CalendarX],
  [/^add\b/i, FilePlus2],
];
// Anything else gets a neutral arrow, so every item has an icon.
const iconFor = (label: string) => ICONS.find(([re]) => re.test(label))?.[1] ?? ArrowRight;

/**
 * The Actions menu at the end of a table row. It opens as a popover (top layer), so a table that
 * scrolls sideways never clips it; it is placed under its button. Unavailable actions are listed
 * with the reason, so the user sees what to do instead.
 */
export function RowActions({ label, items, buttonLabel = "Actions", prominent = false }: { label: string; items: RowAction[]; buttonLabel?: string; /** A page-level menu (e.g. More actions): the size of the page's other buttons. */ prominent?: boolean }) {
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const place = (menu: HTMLElement) => {
    const r = button.current!.getBoundingClientRect();
    const width = Math.min(288, window.innerWidth - 16);
    menu.style.width = `${width}px`;
    menu.style.left = `${Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8))}px`;
    const below = r.bottom + 4;
    menu.style.top = `${below + menu.offsetHeight > window.innerHeight - 8 ? Math.max(8, r.top - menu.offsetHeight - 4) : below}px`;
  };
  const row = "flex w-full items-start gap-2.5 rounded-md px-3 py-2 text-left";
  return (
    <>
      <button
        ref={button}
        type="button"
        popoverTarget={id}
        aria-label={label}
        className={`inline-flex items-center gap-1 border border-slate-300 bg-white font-medium text-slate-700 shadow-sm hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:outline-none ${prominent ? "rounded-lg px-4 py-2 text-sm" : "rounded-md px-2.5 py-1.5 text-xs"}`}
      >
        {buttonLabel} <ChevronDown className={prominent ? "size-4" : "size-3.5"} aria-hidden />
      </button>
      <div
        id={id}
        popover="auto"
        role="menu"
        aria-label={label}
        onToggle={(e) => (e.nativeEvent as ToggleEvent).newState === "open" && place(e.currentTarget)}
        className="fixed m-0 rounded-lg border border-line bg-white p-1 text-left text-sm font-normal whitespace-normal text-ink shadow-lg"
      >
        {items.map((it) => {
          const Icon = iconFor(it.label);
          const icon = <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />;
          if ("href" in it && it.href.startsWith("/api/")) {
            // A file (documents): an ordinary link, not an in-app navigation; viewing opens a new tab.
            const download = it.href.includes("download=1");
            return (
              <a key={it.label} role="menuitem" href={it.href} {...(download ? {} : { target: "_blank", rel: "noopener" })} className={`${row} hover:bg-surface focus-visible:bg-surface focus-visible:outline-none`}>
                {icon}
                <span>{it.label}</span>
              </a>
            );
          }
          if ("href" in it) {
            return (
              <Link key={it.label} role="menuitem" href={it.href} className={`${row} hover:bg-surface focus-visible:bg-surface focus-visible:outline-none ${it.tone === "danger" ? "text-red-700" : ""}`}>
                {icon}
                <span>{it.label}</span>
              </Link>
            );
          }
          if ("action" in it) {
            return (
              <ActionForm key={it.label} action={it.action} className="[&>div]:mx-1 [&>div]:mb-1">
                {Object.entries(it.fields ?? {}).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
                <SubmitButton
                  variant={it.kind === "delete" ? "danger" : "secondary"}
                  confirm={it.confirm}
                  {...(it.kind === "delete" ? { confirmTitle: DELETE_TITLE, confirmLabel: DELETE_LABEL } : {})}
                  {...(it.confirmTitle ? { confirmTitle: it.confirmTitle } : {})}
                  {...(it.confirmLabel ? { confirmLabel: it.confirmLabel } : {})}
                  className={`${row} border-0 bg-transparent font-normal shadow-none hover:bg-surface ${it.tone === "danger" ? "text-red-700" : "text-ink"}`}>
                  {icon}
                  <span>{it.label}</span>
                </SubmitButton>
              </ActionForm>
            );
          }
          return (
            <div key={it.label} role="menuitem" aria-disabled="true" className={`${row} text-slate-400`}>
              {icon}
              <span>
                {it.label}
                <span className="block text-xs text-slate-500">{it.unavailable}</span>
              </span>
            </div>
          );
        })}
      </div>
    </>
  );
}

