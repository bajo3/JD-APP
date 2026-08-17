"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

type CellValue = string | number | boolean | null;
type Row = Record<string, CellValue>;

export type AdminRowAction = Readonly<{
  label: string;
  endpoint: string;
  action?: string;
  nextStatus?: string;
  statuses?: readonly string[];
  confirm?: boolean;
  includeSchedule?: boolean;
}>;

export function AdminTable({
  rows,
  columns,
  actions = [],
}: {
  rows: Row[];
  columns: Array<{ key: string; label: string }>;
  actions?: readonly AdminRowAction[];
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return rows;
    return rows.filter((row) =>
      Object.values(row).some((value) => String(value ?? "").toLowerCase().includes(normalized)),
    );
  }, [rows, query]);

  async function mutate(row: Row, action: AdminRowAction) {
    const id = String(row.id);
    if (action.confirm !== false && !window.confirm(`¿Confirmás ${action.label.toLowerCase()}?`)) return;
    setBusyId(`${id}:${action.label}`);
    setMessage("Guardando…");
    try {
      const body: Record<string, unknown> = { expectedVersion: Number(row.version) };
      if (action.action) body.action = action.action;
      if (action.nextStatus) body.nextStatus = action.nextStatus;
      if (action.includeSchedule) {
        body.startsAt = row.startsAt;
        body.endsAt = row.endsAt;
      }
      const response = await fetch(`${action.endpoint}/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
        throw new Error(
          response.status === 409
            ? "El registro cambió. Recargá antes de continuar."
            : payload?.error?.message ?? "No se pudo guardar el cambio.",
        );
      }
      setMessage("Cambio guardado.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Error inesperado.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="admin-table-block">
      <label className="admin-search">
        Buscar
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filtrar resultados" />
      </label>
      {message ? <p className="admin-feedback" role="status">{message}</p> : null}
      {filtered.length === 0 ? (
        <p className="admin-empty">No hay datos para mostrar.</p>
      ) : (
        <div className="admin-scroll">
          <table className="admin-table">
            <thead><tr>{columns.map((column) => <th key={column.key}>{column.label}</th>)}{actions.length ? <th>Acciones</th> : null}</tr></thead>
            <tbody>
              {filtered.map((row) => {
                const rowActions = actions.filter((action) => !action.statuses || action.statuses.includes(String(row.status)));
                return (
                  <tr key={String(row.id)}>
                    {columns.map((column) => <td key={column.key}>{formatCell(row[column.key])}</td>)}
                    {actions.length ? (
                      <td className="admin-actions">
                        {rowActions.length ? rowActions.map((action) => {
                          const key = `${String(row.id)}:${action.label}`;
                          return <button className="panel-action" disabled={busyId !== null} key={action.label} onClick={() => mutate(row, action)}>{busyId === key ? "Guardando…" : action.label}</button>;
                        }) : <span className="panel-muted">Sin acciones</span>}
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function formatCell(value: CellValue): string {
  if (typeof value === "boolean") return value ? "Sí" : "No";
  if (value === null || value === "") return "—";
  return String(value);
}
