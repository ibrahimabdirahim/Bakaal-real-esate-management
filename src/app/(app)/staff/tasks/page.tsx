import { requirePage } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { listStaff, listTasks } from "@/server/services/operations";
import { Badge, Card, FilterBar, FilterSelect, FilterSubmit, PageHeader, Table, Td } from "@/components/ui";
import { StaffTabs } from "../staff-tabs";
import { ActionForm, Select, SubmitButton, TextInput } from "@/components/forms";
import { RowActions, type RowAction } from "@/components/row-actions";
import { formatDate, optionalFromDbDate, todayISO } from "@/lib/dates";
import { closeTaskAction, createTaskAction } from "../actions";
import { StatusBadge } from "@/components/status";
import { ClipboardCheck } from "lucide-react";

export const metadata = { title: "Service tasks" };

export default async function TasksPage({ searchParams }: PageProps<"/staff/tasks">) {
  const actor = await requirePage("staff.view");
  const sp = await searchParams;
  const status = (typeof sp.status === "string" ? sp.status : "OPEN") as "OPEN" | "DONE" | "CANCELLED" | "";
  const [tasks, staff] = await Promise.all([listTasks(actor, status), listStaff(actor)]);
  const manage = can(actor.role, "tasks.manage");
  const today = todayISO();

  return (
    <>
      <PageHeader icon={ClipboardCheck} title="Service tasks and schedules" description="Cleaning, security rounds, garbage collection, inspections and other recurring duties." />
      <StaffTabs actor={actor} current="tasks" />
      {manage && (
        <Card title="New task" className="mb-6">
          <ActionForm action={createTaskAction}>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
              <div className="sm:col-span-2"><TextInput label="Task" name="title" required placeholder="e.g. Clean stairwell, floors 1–3" /></div>
              <Select label="Assigned to" name="staffMemberId" placeholder="Unassigned" options={staff.map((s) => ({ value: s.id, label: `${s.fullName} (${s.position})` }))} />
              <TextInput label="Due date" name="dueDate" type="date" />
            </div>
            <SubmitButton>Create task</SubmitButton>
          </ActionForm>
        </Card>
      )}
      <Card>
        <FilterBar>
          <FilterSelect label="Status" name="status" defaultValue={status} options={[{ value: "OPEN", label: "Open" }, { value: "DONE", label: "Done" }, { value: "CANCELLED", label: "Cancelled" }, { value: "", label: "All" }]} />
          <FilterSubmit />
        </FilterBar>
        <Table head={["Task", "Assigned to", "Due", "Status", ...(manage ? [<span key="a" className="sr-only">Actions</span>] : [])]} empty="No tasks.">
          {tasks.map((t) => {
            const due = optionalFromDbDate(t.dueDate);
            return (
              <tr key={t.id}>
                <Td wrap>{t.title}</Td>
                <Td>{t.staffMember?.fullName ?? "—"}</Td>
                <Td>{formatDate(due)} {t.status === "OPEN" && due && due < today && <Badge tone="red">late</Badge>}</Td>
                <Td><StatusBadge kind="task" status={t.status} /></Td>
                {manage && (
                  <Td className="w-px text-right">
                    <RowActions
                      label={`Actions for task ${t.title}`}
                      items={[
                        ...(t.status === "OPEN"
                          ? ([
                              { label: "Mark done", action: closeTaskAction.bind(null, t.id, "DONE"), confirm: `Mark "${t.title}" as done?` },
                              { label: "Cancel task", action: closeTaskAction.bind(null, t.id, "CANCELLED"), confirm: `Cancel "${t.title}"? It stays in the list as cancelled.`, tone: "danger" },
                            ] as RowAction[])
                          : []),
                        { label: "Edit task", unavailable: t.status === "OPEN" ? "Tasks are not edited: cancel this one and create a new task." : "Done and cancelled tasks are kept as they were." },
                        { label: "Delete task", unavailable: "Tasks are closed (done or cancelled), not deleted, so the staff record keeps its history." },
                      ]}
                    />
                  </Td>
                )}
              </tr>
            );
          })}
        </Table>
      </Card>
    </>
  );
}
