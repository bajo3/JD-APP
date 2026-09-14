export default function ConversacionesLoading() {
  return (
    <div className="panel-loading" role="status" aria-live="polite">
      <span className="panel-loading-line is-title" />
      <span className="panel-loading-line" />
      <span className="panel-loading-card" />
      <span className="sr-only">Cargando conversaciones…</span>
    </div>
  );
}
