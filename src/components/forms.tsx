"use client";

import { createContext, useActionState, useContext, useEffect, useRef, type ReactNode } from "react";
import { DELETE_LABEL, DELETE_TITLE, deleteMessage } from "@/lib/delete-confirm";
import { useFormStatus } from "react-dom";
import { AlertCircle, CheckCircle2, KeyRound, Loader2, TriangleAlert } from "lucide-react";
import type { ActionState } from "@/server/action";

type Action = (state: ActionState, form: FormData) => Promise<ActionState>;

const FieldErrors = createContext<Record<string, string> | undefined>(undefined);

/**
 * A form bound to a server action, showing success, errors and field errors. Children
 * may be a function of the latest state, e.g. to show the submitted values again.
 */
export function ActionForm({
  action,
  children,
  className = "space-y-4",
}: {
  action: Action;
  children: ReactNode | ((state: ActionState) => ReactNode);
  className?: string;
}) {
  const [state, formAction] = useActionState(action, undefined);
  return (
    <form action={formAction} className={className}>
      <FormMessage state={state} />
      <FieldErrors.Provider value={state?.fieldErrors}>{typeof children === "function" ? children(state) : children}</FieldErrors.Provider>
    </form>
  );
}

export function FormMessage({ state }: { state: ActionState }) {
  if (!state) return null;
  return (
    <div aria-live="polite" className="space-y-2">
      {state.error && (
        <p role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800">
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          {state.error}
        </p>
      )}
      {state.success && (
        <p role="status" className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
          {state.success}
        </p>
      )}
      {state.reveal && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
          <p className="flex items-center gap-2 font-medium">
            <KeyRound className="size-4" aria-hidden /> {state.reveal.label}
          </p>
          <p className="mt-1 font-mono text-base break-all select-all">{state.reveal.value}</p>
          <p className="mt-1 text-xs">This is shown only once. Give it to the staff member privately; they should change it after signing in.</p>
        </div>
      )}
    </div>
  );
}

export function useFieldError(name: string) {
  return useContext(FieldErrors)?.[name];
}

export const inputClass =
  "mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-primary-500 focus:ring-1 focus:ring-primary-500 focus:outline-none disabled:bg-slate-100 aria-[invalid=true]:border-red-400 aria-[invalid=true]:ring-red-400";

interface FieldProps {
  label: string;
  name: string;
  hint?: string;
  required?: boolean;
}

export function Field({ label, name, hint, required, children }: FieldProps & { children: ReactNode }) {
  const error = useFieldError(name);
  return (
    <div>
      <label htmlFor={name} className="block text-sm font-medium text-slate-700">
        {label}
        {required && <span className="text-red-600"> *</span>}
      </label>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
      {error && (
        <p className="mt-1 flex items-center gap-1 text-xs text-red-700">
          <AlertCircle className="size-3.5" aria-hidden /> {error}
        </p>
      )}
    </div>
  );
}

/**
 * The browser's message for an empty required field, naming the field ("Choose an option for “Paid by”.")
 * instead of a generic one. Cleared as soon as the value changes, so it never blocks a filled-in field.
 */
function namedRequired<E extends HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(label: string, rest: { onInvalid?: React.FormEventHandler<E>; onInput?: React.FormEventHandler<E> }, choose = false) {
  return {
    onInvalid: (e: React.FormEvent<E>) => {
      if (e.currentTarget.validity.valueMissing) e.currentTarget.setCustomValidity(choose ? `Choose an option for “${label}”.` : `Fill in “${label}”.`);
      rest.onInvalid?.(e);
    },
    onInput: (e: React.FormEvent<E>) => {
      e.currentTarget.setCustomValidity("");
      rest.onInput?.(e);
    },
  };
}

export function TextInput({ label, name, hint, required, ...rest }: FieldProps & React.InputHTMLAttributes<HTMLInputElement>) {
  const error = useFieldError(name);
  return (
    <Field label={label} name={name} hint={hint} required={required}>
      <input id={name} name={name} required={required} aria-invalid={!!error} className={inputClass} {...rest} {...namedRequired(label, rest)} />
    </Field>
  );
}

export function TextArea({ label, name, hint, required, ...rest }: FieldProps & React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const error = useFieldError(name);
  return (
    <Field label={label} name={name} hint={hint} required={required}>
      <textarea id={name} name={name} required={required} rows={3} aria-invalid={!!error} className={inputClass} {...rest} {...namedRequired(label, rest)} />
    </Field>
  );
}

export function Select({
  label,
  name,
  hint,
  required,
  options,
  placeholder,
  ...rest
}: FieldProps & React.SelectHTMLAttributes<HTMLSelectElement> & { options: { value: string; label: string }[]; placeholder?: string }) {
  const error = useFieldError(name);
  return (
    <Field label={label} name={name} hint={hint} required={required}>
      <select id={name} name={name} required={required} aria-invalid={!!error} className={inputClass} {...rest} {...namedRequired(label, rest, true)}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

const BUTTON_STYLES = {
  primary: "bg-primary-600 text-white shadow-sm hover:bg-primary-700",
  secondary: "border border-slate-300 bg-white text-slate-700 shadow-sm hover:bg-slate-50",
  danger: "bg-red-600 text-white shadow-sm hover:bg-red-700",
} as const;

/**
 * Submit button. With `confirm`, it first opens an accessible confirmation dialog;
 * confirming submits the form with this button as the submitter (name/value kept).
 */
export function SubmitButton({
  children,
  variant = "primary",
  name,
  value,
  confirm,
  confirmTitle = "Please confirm",
  confirmLabel,
  className,
}: {
  children: ReactNode;
  variant?: keyof typeof BUTTON_STYLES;
  name?: string;
  value?: string;
  confirm?: string;
  /** The dialog's heading and its confirm button (default: the button's own text). See DeleteButton. */
  confirmTitle?: string;
  confirmLabel?: string;
  /** Replaces the button's look (e.g. an item in an Actions menu); behaviour is unchanged. */
  className?: string;
}) {
  const { pending } = useFormStatus();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  // The dialog stays open, its confirm button disabled, until the server has answered (no second submission).
  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !pending) dialogRef.current?.close();
    wasPending.current = pending;
  }, [pending]);

  return (
    <>
      <button
        ref={buttonRef}
        type="submit"
        name={name}
        value={value}
        disabled={pending}
        onClick={(e) => {
          // requestSubmit() below submits without a click, so this only intercepts the user's click.
          if (!confirm) return;
          e.preventDefault();
          // Check the fields first: the browser cannot point at a field behind an open popup, so an
          // invalid form would otherwise do nothing visible when the popup's button is pressed.
          const form = buttonRef.current?.form;
          if (form && !form.checkValidity()) {
            form.reportValidity();
            return;
          }
          dialogRef.current?.showModal();
        }}
        className={className ? `${className} transition disabled:cursor-wait disabled:opacity-60` : `inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition disabled:cursor-wait disabled:opacity-60 ${BUTTON_STYLES[variant]}`}
      >
        {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
        {pending ? "Working…" : children}
      </button>
      {confirm && (
        <dialog ref={dialogRef} aria-labelledby={`${name ?? "confirm"}-title`} onCancel={(e) => pending && e.preventDefault()} className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-xl border border-slate-200 p-0 shadow-xl">
          <div className="p-5">
            <div className="flex items-start gap-3">
              <span className={`flex size-10 shrink-0 items-center justify-center rounded-full ${variant === "danger" ? "bg-red-50 text-red-600" : "bg-primary-50 text-primary-600"}`}>
                <TriangleAlert className="size-5" aria-hidden />
              </span>
              <div>
                <h2 id={`${name ?? "confirm"}-title`} className="text-base font-semibold text-navy-900">
                  {confirmTitle}
                </h2>
                <p className="mt-1 text-sm text-slate-600">{confirm}</p>
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-2 rounded-b-xl border-t border-slate-100 bg-slate-50 px-5 py-3">
            <button type="button" disabled={pending} onClick={() => dialogRef.current?.close()} className={`rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-60 ${BUTTON_STYLES.secondary}`}>
              Cancel
            </button>
            <button
              type="button"
              autoFocus
              disabled={pending}
              onClick={() => {
                const button = buttonRef.current;
                if (!button?.form || pending) return;
                // Something became invalid while the popup was open (e.g. an upload started): close it and show why.
                if (!button.form.checkValidity()) {
                  dialogRef.current?.close();
                  button.form.reportValidity();
                  return;
                }
                // requestSubmit keeps the clicked button's name/value in the form data.
                button.form.requestSubmit(button);
              }}
              className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium disabled:cursor-wait disabled:opacity-60 ${BUTTON_STYLES[variant === "danger" ? "danger" : "primary"]}`}
            >
              {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {pending ? "Working…" : (confirmLabel ?? children)}
            </button>
          </div>
        </dialog>
      )}
    </>
  );
}


/** A Delete button that asks once (the shared dialog) and then submits its form. The server still checks every rule. */
export function DeleteButton({ what = "record", children = "Delete", className }: { what?: string; children?: ReactNode; className?: string }) {
  return (
    <SubmitButton variant="danger" confirm={deleteMessage(what)} confirmTitle={DELETE_TITLE} confirmLabel={DELETE_LABEL} className={className}>
      {children}
    </SubmitButton>
  );
}
