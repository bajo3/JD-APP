import { chatGPTSignOutPath } from "../chatgpt-auth";
import type { PanelAccessErrorCode } from "@/lib/server/panel-auth";

type ProtectedStateProps = {
  code: PanelAccessErrorCode;
};

export function PanelProtectedState({ code }: ProtectedStateProps) {
  const unavailable = code === "PANEL_ACCESS_NOT_CONFIGURED";

  return (
    <main className="min-h-screen bg-[#18201f] px-5 py-16 text-[#f4f2ec]">
      <section
        aria-labelledby="panel-access-title"
        className="mx-auto max-w-xl rounded-2xl border border-white/10 bg-white/5 p-7 shadow-2xl sm:p-10"
      >
        <p className="mb-5 text-xs font-bold uppercase tracking-[0.2em] text-[#ff9973]">
          Panel interno
        </p>
        <h1
          id="panel-access-title"
          className="m-0 text-3xl font-bold tracking-tight"
        >
          {unavailable ? "Panel no disponible" : "Acceso restringido"}
        </h1>
        <p className="mt-4 max-w-lg text-sm leading-6 text-[#c7d0cc]">
          {unavailable
            ? "La configuración de acceso todavía no está habilitada. Contactá al administrador del sitio."
            : "Tu cuenta inició sesión correctamente, pero no está autorizada para usar este espacio."}
        </p>
        <a
          className="mt-8 inline-flex min-h-11 items-center rounded-lg border border-white/20 px-5 text-sm font-bold hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#ff9973]"
          href={chatGPTSignOutPath("/")}
        >
          Cerrar sesión
        </a>
      </section>
    </main>
  );
}
