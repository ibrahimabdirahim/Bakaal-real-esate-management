"use client";

import { useState } from "react";
import { ActionForm, Select, SubmitButton, TextArea, TextInput } from "@/components/forms";
import { AccountSelect, AccountUnitsSummary } from "@/components/account-picker";
import { isISODate, todayISO } from "@/lib/dates";
import { DocumentUploader } from "@/components/document-uploader";
import { recordPaymentAction } from "../actions";

/**
 * Record payment. With `oneStep` (single-operator, F49: someone who may record, verify and allocate)
 * the payment is saved verified and the amounts entered against open invoices are allocated at once;
 * otherwise it is saved pending verification, as before.
 */
export function PaymentForm({
  parties,
  partyId,
  maxBytes,
  showTerms,
  oneStep,
  invoice,
}: {
  parties: { value: string; label: string }[];
  partyId: string;
  maxBytes: number;
  showTerms: boolean;
  oneStep: boolean;
  /** Opened from an invoice's Record payment: that invoice and its remaining balance (suggested amount). */
  invoice: { id: string; number: string | null; balance: string } | null;
}) {
  const [account, setAccount] = useState(partyId);
  const [received, setReceived] = useState("");
  return (
    <ActionForm action={recordPaymentAction}>
      {oneStep && <input type="hidden" name="verify" value="1" />}
      <AccountSelect label="Received from (account)" parties={parties} value={account} onChange={setAccount} />
      {invoice && account === partyId && <p className="text-sm text-muted">{`For invoice ${invoice.number}: KES ${invoice.balance} remaining. A smaller amount records a part payment.`}</p>}
      {/* The account's units, balance and open invoices (for reference; allocation follows the existing rules). */}
      {showTerms && <AccountUnitsSummary partyId={account} on={isISODate(received) ? received : todayISO()} allocate={oneStep ? { prefillInvoiceId: account === partyId ? invoice?.id : undefined } : undefined} />}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Select label="Method" name="method" required options={[{ value: "MPESA", label: "M-Pesa" }, { value: "BANK", label: "Bank transfer" }, { value: "CASH", label: "Cash" }]} />
        <TextInput label="Reference" name="reference" required hint="M-Pesa code, bank reference or cash receipt-book number. Must be unique per method." />
        <TextInput label="Amount (KES)" name="amount" inputMode="decimal" required defaultValue={invoice?.balance ?? ""} />
        <TextInput label="Date received" name="receivedDate" type="date" required value={received} onChange={(e) => setReceived(e.target.value)} />
      </div>
      <TextArea label="Evidence notes" name="evidenceNote" hint="Describe the proof seen (e.g. SMS screenshot). Proof alone is not confirmation; verification checks the actual statement." />
      <DocumentUploader ownerType="PAYMENT" maxBytes={maxBytes} slots={[{ category: "PROOF_OF_PAYMENT", label: "Proof of payment (optional)", hint: "M-Pesa message screenshot, bank slip or deposit receipt. Kept with the payment for the verifier.", multiple: true }]} />
      <SubmitButton>{oneStep ? "Record payment" : "Record pending payment"}</SubmitButton>
      {!oneStep && <p className="text-xs text-muted">Your role records payments for verification by a finance officer or administrator.</p>}
    </ActionForm>
  );
}
