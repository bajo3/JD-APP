"use client";

import { FormEvent, useState } from "react";
import { PASSWORD_MIN_LENGTH } from "@/lib/auth/index.mjs";

type Mode = "register" | "login";
type ApiRecord = Record<string, unknown>;

async function send(path: string, method: string, payload: ApiRecord): Promise<ApiRecord> {
  const response = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = (await response.json().catch(() => ({}))) as ApiRecord;
  if (!response.ok) {
    const error = body.error as ApiRecord | undefined;
    const fields = (error?.fields as Record<string, string> | undefined) ?? {};
    const message = (error?.message as string | undefined) ?? "No pudimos completar la operación.";
    throw Object.assign(new Error(message), { fields });
  }
  return body;
}

export function AccountAuthForm({ mode, next = "/cuenta" }: { mode: Mode; next?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setFields({});
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      if (mode === "register") {
        await send("/api/v1/account", "POST", {
          name: String(form.get("name") ?? ""),
          email: String(form.get("email") ?? ""),
          phone: String(form.get("phone") ?? ""),
          password: String(form.get("password") ?? ""),
          acceptedTerms: form.get("acceptedTerms") === "on",
        });
      } else {
        await send("/api/v1/account/sessions", "POST", {
          email: String(form.get("email") ?? ""),
          password: String(form.get("password") ?? ""),
        });
      }
      // Recarga completa: la sesión vive en una cookie HttpOnly y las páginas
      // se renderizan en el servidor con ella.
      window.location.assign(next);
    } catch (caught) {
      const failure = caught as Error & { fields?: Record<string, string> };
      setError(failure.message);
      setFields(failure.fields ?? {});
      setBusy(false);
    }
  };

  const fieldError = (name: string) =>
    fields[name] ? <small className="field-error">{fields[name]}</small> : null;

  return (
    <form className="lead-form" onSubmit={submit} noValidate>
      {mode === "register" ? (
        <>
          <label>
            Nombre y apellido
            <input name="name" autoComplete="name" required minLength={2} placeholder="Ej. Martín González" />
            {fieldError("name")}
          </label>
          <label>
            Teléfono / WhatsApp <span className="field-optional">(opcional)</span>
            <input name="phone" autoComplete="tel" inputMode="tel" placeholder="249 458-7046" />
            {fieldError("phone")}
          </label>
        </>
      ) : null}

      <label>
        Correo
        <input
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          placeholder="tunombre@correo.com"
        />
        {fieldError("email")}
      </label>

      <label>
        Contraseña
        <input
          name="password"
          type="password"
          autoComplete={mode === "register" ? "new-password" : "current-password"}
          required
          minLength={mode === "register" ? PASSWORD_MIN_LENGTH : undefined}
          placeholder={mode === "register" ? `Al menos ${PASSWORD_MIN_LENGTH} caracteres` : ""}
        />
        {fieldError("password")}
      </label>

      {mode === "register" ? (
        <>
          <label className="consent-check">
            <input type="checkbox" name="acceptedTerms" /> Acepto que Jesús Díaz Automotores
            guarde estos datos para atender mi consulta.
          </label>
          {fieldError("acceptedTerms")}
        </>
      ) : null}

      {error ? <p className="form-error" role="alert">{error}</p> : null}

      <button className="primary-button" disabled={busy}>
        {busy ? "Enviando…" : mode === "register" ? "Crear cuenta" : "Ingresar"}
        <span>→</span>
      </button>

      <p className="form-switch">
        {mode === "register" ? (
          <>¿Ya tenés cuenta? <a href="/cuenta/ingresar">Ingresá acá</a>.</>
        ) : (
          <>¿Todavía no tenés? <a href="/cuenta/crear">Creá tu cuenta</a>.</>
        )}
      </p>
    </form>
  );
}
