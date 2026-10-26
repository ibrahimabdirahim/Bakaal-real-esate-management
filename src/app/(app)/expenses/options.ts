import { db } from "@/server/db";

/** Choices for the expense form. Salaries have their own form (Staff → Salary Payments). */
export async function expenseFormOptions() {
  const workOrders = await db.workOrder.findMany({ select: { id: true, number: true, title: true }, orderBy: { createdAt: "desc" }, take: 100 });
  return { workOrders: workOrders.map((w) => ({ value: w.id, label: `${w.number} — ${w.title}` })) };
}
