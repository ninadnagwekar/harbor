import { useEffect, useMemo, useState } from "react"
import {
  getCoreRowModel,
  getSortedRowModel,
  useLegacyTable,
  type LegacyColumnDef,
} from "@tanstack/react-table/legacy"

type SortingState = { id: string; desc: boolean }[]
type VisibilityState = Record<string, boolean>
import { flexRender } from "@tanstack/react-table"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { selectClass } from "@/components/ui-bits"
import { PRIORITIES, TASK_STATUSES, TASK_TYPES, dueMeta, labelOf } from "@/lib/labels"
import type { Task, TaskPatch, TaskStatus, UserBrief } from "@/lib/types"
import { cn } from "@/lib/utils"

const STORAGE_KEY = "harbor.table.columns"

export function TableView({
  tasks,
  members,
  showProject,
  onOpen,
  onPatch,
  onBulk,
}: {
  tasks: Task[]
  members: UserBrief[]
  showProject?: boolean
  onOpen: (id: string) => void
  onPatch: (id: string, patch: TaskPatch) => void
  onBulk: (ids: string[], patch: TaskPatch) => Promise<void>
}) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [rowSelection, setRowSelection] = useState({})
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(() => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") as VisibilityState
    } catch {
      return {}
    }
  })
  const [bulkStatus, setBulkStatus] = useState<TaskStatus>("todo")
  const [bulkAssignee, setBulkAssignee] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(columnVisibility))
  }, [columnVisibility])

  const columns = useMemo<LegacyColumnDef<Task>[]>(
    () => [
      {
        id: "select",
        header: ({ table }) => (
          <input
            type="checkbox"
            checked={table.getIsAllPageRowsSelected()}
            onChange={table.getToggleAllPageRowsSelectedHandler()}
            aria-label="Select all tasks"
          />
        ),
        cell: ({ row }) => (
          <input
            type="checkbox"
            checked={row.getIsSelected()}
            onChange={row.getToggleSelectedHandler()}
            onClick={(event) => event.stopPropagation()}
            aria-label={`Select ${row.original.title}`}
          />
        ),
        enableSorting: false,
      },
      {
        accessorKey: "title",
        header: "Task",
        cell: ({ row }) => (
          <button type="button" className="text-left font-medium hover:underline" onClick={() => onOpen(row.original.id)}>
            {row.original.title}
            {row.original.task_type === "bug" ? <span className="ml-2 text-[10px] font-semibold tracking-wide text-rose-600 uppercase">Bug</span> : null}
          </button>
        ),
      },
      {
        id: "type",
        accessorKey: "task_type",
        header: "Type",
        cell: ({ row }) => <span className="capitalize">{labelOf(TASK_TYPES, row.original.task_type)}</span>,
      },
      ...(showProject
        ? [
            {
              id: "project",
              accessorKey: "project_name",
              header: "Project",
              cell: ({ row }) => row.original.project_name,
            } as LegacyColumnDef<Task>,
          ]
        : []),
      {
        id: "assignee",
        header: "Assignee",
        accessorFn: (row) => row.assignee?.name ?? "",
        cell: ({ row }) => (
          <select
            className={selectClass("h-7 max-w-40")}
            value={row.original.assignee?.id ?? ""}
            onChange={(event) => onPatch(row.original.id, { assignee_id: event.target.value || null })}
            aria-label={`Assignee for ${row.original.title}`}
          >
            <option value="">Unassigned</option>
            {members.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
        ),
      },
      {
        accessorKey: "priority",
        header: "Priority",
        cell: ({ row }) => <span className="capitalize">{labelOf(PRIORITIES, row.original.priority)}</span>,
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => (
          <select
            className={selectClass("h-7")}
            value={row.original.status}
            onChange={(event) => onPatch(row.original.id, { status: event.target.value as TaskStatus })}
            aria-label={`Status for ${row.original.title}`}
          >
            {TASK_STATUSES.map((status) => (
              <option key={status.id} value={status.id}>
                {status.label}
              </option>
            ))}
          </select>
        ),
      },
      {
        accessorKey: "due_date",
        header: "Due",
        cell: ({ row }) => {
          const due = dueMeta(row.original.due_date, row.original.status)
          return <span className={cn(due?.overdue && "font-medium text-rose-600")}>{due?.text ?? "—"}</span>
        },
      },
      {
        accessorKey: "estimate_hours",
        header: "Estimate",
        cell: ({ row }) => (row.original.estimate_hours == null ? "—" : `${row.original.estimate_hours}h`),
      },
      {
        id: "tags",
        header: "Tags",
        accessorFn: (row) => row.tags.join(", "),
        cell: ({ row }) => <span className="text-muted-foreground">{row.original.tags.join(", ") || "—"}</span>,
      },
    ],
    [members, onOpen, onPatch, showProject],
  )

  const table = useLegacyTable({
    data: tasks,
    columns,
    state: { sorting, columnVisibility, rowSelection },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    enableRowSelection: true,
    getRowId: (row) => row.id,
  })

  const selected = table.getSelectedRowModel().rows.map((row) => row.original.id)

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{tasks.length} tasks</p>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              Columns
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {table.getAllLeafColumns().filter((column) => column.id !== "select").map((column) => (
              <DropdownMenuCheckboxItem
                key={column.id}
                checked={column.getIsVisible()}
                onCheckedChange={(value) => column.toggleVisibility(!!value)}
              >
                {typeof column.columnDef.header === "string" ? column.columnDef.header : column.id}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {selected.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card px-3 py-2">
          <span className="text-sm">{selected.length} selected</span>
          <select className={selectClass()} value={bulkStatus} onChange={(event) => setBulkStatus(event.target.value as TaskStatus)} aria-label="Bulk status">
            {TASK_STATUSES.map((status) => (
              <option key={status.id} value={status.id}>
                {status.label}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => {
              setBusy(true)
              void onBulk(selected, { status: bulkStatus }).finally(() => {
                setBusy(false)
                setRowSelection({})
              })
            }}
          >
            Set status
          </Button>
          <select className={selectClass()} value={bulkAssignee} onChange={(event) => setBulkAssignee(event.target.value)} aria-label="Bulk assignee">
            <option value="">Choose assignee</option>
            {members.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !bulkAssignee}
            onClick={() => {
              setBusy(true)
              void onBulk(selected, { assignee_id: bulkAssignee }).finally(() => {
                setBusy(false)
                setRowSelection({})
              })
            }}
          >
            Assign
          </Button>
        </div>
      ) : null}
      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="border-b text-left text-xs text-muted-foreground">
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {group.headers.map((header) => (
                  <th key={header.id} className="px-3 py-2 font-medium">
                    {header.isPlaceholder ? null : (
                      <button
                        type="button"
                        className={cn(header.column.getCanSort() && "hover:text-foreground")}
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {{ asc: " ↑", desc: " ↓" }[header.column.getIsSorted() as string] ?? ""}
                      </button>
                    )}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-3 py-10 text-center text-muted-foreground">
                  No tasks match these filters.
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => (
                <tr key={row.id} className="border-b last:border-b-0">
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-3 py-2 align-middle">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
