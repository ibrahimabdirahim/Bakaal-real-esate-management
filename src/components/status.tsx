import { Badge, type BadgeTone } from "@/components/ui";

// One status vocabulary for the whole application, so the same state always looks the same.
const STATUS: Record<string, Record<string, [string, BadgeTone]>> = {
  agreement: { ACTIVE: ["Active", "green"], ENDED: ["Ended", "slate"], CANCELLED: ["Cancelled", "red"] },
  payment: { PENDING: ["Pending verification", "amber"], VERIFIED: ["Verified", "green"], REJECTED: ["Rejected", "red"], REVERSED: ["Reversed", "slate"] },
  expense: { DRAFT: ["Draft", "slate"], SUBMITTED: ["Awaiting approval", "amber"], APPROVED: ["Approved", "blue"], REJECTED: ["Rejected", "red"], PAID: ["Paid", "green"] },
  // Salary payments are expenses; "approved" is spelled out because approval is not payment.
  salary: { DRAFT: ["Draft", "slate"], SUBMITTED: ["Pending approval", "amber"], APPROVED: ["Approved — not yet paid", "blue"], REJECTED: ["Rejected", "red"], PAID: ["Paid", "green"] },
  workorder: { OPEN: ["Open", "amber"], ASSIGNED: ["Assigned", "blue"], IN_PROGRESS: ["In progress", "purple"], COMPLETED: ["Completed", "green"], CANCELLED: ["Cancelled", "slate"] },
  task: { OPEN: ["Open", "amber"], DONE: ["Done", "green"], CANCELLED: ["Cancelled", "slate"] },
  priority: { LOW: ["Low", "slate"], MEDIUM: ["Medium", "blue"], HIGH: ["High", "amber"], URGENT: ["Urgent", "red"] },
  policy: { APPROVED: ["Approved — in effect", "green"], PROPOSED: ["Proposed — not in effect", "amber"] },
  user: { ACTIVE: ["Active", "green"], INACTIVE: ["Deactivated", "red"], LOCKED: ["Locked", "amber"] },
};

export type StatusKind = keyof typeof STATUS;

export function statusLabel(kind: StatusKind, status: string): string {
  return STATUS[kind][status]?.[0] ?? status;
}

export function StatusBadge({ kind, status }: { kind: StatusKind; status: string }) {
  const [label, tone] = STATUS[kind][status] ?? [status, "slate" as BadgeTone];
  return <Badge tone={tone}>{label}</Badge>;
}
