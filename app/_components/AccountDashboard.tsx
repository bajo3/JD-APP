"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";

type ApiRecord = Record<string, unknown>;

export type DashboardAccount = Readonly<{
  name: string;
  email: string;
  phone: string | null;
  linkedToCrm: boolean;
}>;

export type DashboardPreferences = Readonly<{
  budgetCents: number | null;
  maxMonthlyPaymentCents: number | null;
  preferredMakes: readonly string[];
  preferredBodyTypes: readonly string[];
  currentVehicle: Readonly<Record<string, unknown>> | null;
}>;

export type DashboardFavorite = Readonly<{
  vehicleId: string;
  slug: string;
  make: string;
  model: string;
  trim: string;
  year: number;
  mileageKm: number;
  priceCents: number;
  currency: string;
  status: string;
}>;

export type DashboardSearch = Readonly<{
  id: string;
  name: string;
  query: Readonly<Record<string, unknown>>;
}>;

const BODY_TYPES = ["auto", "suv", "pickup"] as const;

async function send(path: string, method: string, payload?: ApiRecord): Promise<void> {
  const response = await fetch(path, {
    method,
    ...(payload ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) } : {}),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ApiRecord;
    const error = body.error as ApiRecord | undefined;
    throw new Error((error?.message as string | undefined) ?? "No pudimos guardar el cambio.");
  }
}

function money(cents: number | null, currency = "ARS"): string {
  if (cents === null) return "—";
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function pesos(value: string): number | null {
  const digits = value.replace(/\D/g, "");
  return digits ? Number(digits) * 100 : null;
}

function searchSummary(query: Readonly<Record<string, unknown>>): string {
  const labels: Record<string, string> = {
    make: "Marca",
    bodyType: "Tipo",
    fuelType: "Combustible",
    transmission: "Caja",
    minPriceCents: "Precio desde",
    maxPriceCents: "Precio hasta",
    minYear: "Año desde",
    maxYear: "Año hasta",
    minMileageKm: "Km desde",
    maxMileageKm: "Km hasta",
  };
  const parts = Object.entries(query)
    .filter(([, value]) => value !== null && value !== "")
    .map(([key, value]) => {
      const display = key.endsWith("PriceCents") && typeof value === "number"
        ? `${new Intl.NumberFormat("es-AR").format(value / 100)} (moneda a confirmar)`
        : String(value);
      return `${labels[key] ?? key}: ${display}`;
    });
  return parts.join(" · ") || "Sin filtros";
}

export function AccountDashboard({
  account,
  preferences,
  favorites,
  searches,
}: {
  account: DashboardAccount;
  preferences: DashboardPreferences;
  favorites: readonly DashboardFavorite[];
  searches: readonly DashboardSearch[];
}) {
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [visibleFavorites, setVisibleFavorites] = useState(favorites);
  const [visibleSearches, setVisibleSearches] = useState(searches);

  const run = async (action: () => Promise<void>, done: string) => {
    setBusy(true);
    setError("");
    setStatus("");
    try {
      await action();
      setStatus(done);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No pudimos guardar el cambio.");
    } finally {
      setBusy(false);
    }
  };

  const saveProfile = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void run(
      () =>
        send("/api/v1/account/me", "PATCH", {
          name: String(form.get("name") ?? ""),
          phone: String(form.get("phone") ?? ""),
        }),
      "Datos actualizados.",
    );
  };

  const savePreferences = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void run(
      () =>
        send("/api/v1/account/preferences", "PUT", {
          budgetCents: pesos(String(form.get("budget") ?? "")),
          maxMonthlyPaymentCents: pesos(String(form.get("monthly") ?? "")),
          preferredMakes: String(form.get("makes") ?? "")
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean),
          preferredBodyTypes: BODY_TYPES.filter((type) => form.get(`body-${type}`) === "on"),
          currentVehicle: {
            make: String(form.get("currentMake") ?? ""),
            model: String(form.get("currentModel") ?? ""),
            year: Number(form.get("currentYear") ?? 0),
            mileageKm: Number(form.get("currentKm") ?? 0),
          },
        }),
      "Preferencias guardadas.",
    );
  };

  const savePassword = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const element = event.currentTarget;
    const form = new FormData(element);
    void run(async () => {
      await send("/api/v1/account/password", "PUT", {
        currentPassword: String(form.get("currentPassword") ?? ""),
        newPassword: String(form.get("newPassword") ?? ""),
      });
      element.reset();
    }, "Contraseña actualizada. Se cerraron las otras sesiones.");
  };

  const removeFavorite = (vehicleId: string) =>
    run(async () => {
      await send(`/api/v1/account/favorites/${encodeURIComponent(vehicleId)}`, "DELETE");
      setVisibleFavorites((current) => current.filter((item) => item.vehicleId !== vehicleId));
    }, "Sacamos la unidad de tus favoritos.");

  const removeSearch = (searchId: string) =>
    run(async () => {
      await send(`/api/v1/account/searches/${encodeURIComponent(searchId)}`, "DELETE");
      setVisibleSearches((current) => current.filter((item) => item.id !== searchId));
    }, "Búsqueda eliminada.");

  const currentVehicle = (preferences.currentVehicle ?? {}) as Record<string, unknown>;

  return (
    <div className="account-sections">
      <div aria-live="polite" className="account-feedback">
        {busy ? <p className="form-status">Guardando el cambio…</p> : null}
        {status ? <p className="form-status">{status}</p> : null}
        {error ? <p className="form-error" role="alert">{error}</p> : null}
      </div>

      <section className="account-card account-card-favorites" aria-labelledby="favoritos">
        <h2 id="favoritos">Favoritos <span className="account-count">{visibleFavorites.length}</span></h2>
        {visibleFavorites.length === 0 ? (
          <p className="detail-meta">
            Todavía no guardaste ninguna unidad. Marcá las que te interesen desde
            su ficha y las vas a encontrar acá. <Link href="/stock">Explorar stock</Link>.
          </p>
        ) : (
          <ul className="account-list">
            {visibleFavorites.map((favorite) => (
              <li key={favorite.vehicleId}>
                <div>
                  <Link href={`/autos/${favorite.slug}`}>
                    <strong>{favorite.make} {favorite.model} {favorite.trim}</strong>
                  </Link>
                  <small>
                    {favorite.year} · {new Intl.NumberFormat("es-AR").format(favorite.mileageKm)} km ·{" "}
                    {money(favorite.priceCents, favorite.currency)}
                    {favorite.status === "AVAILABLE" ? "" : " · ya no está publicada"}
                  </small>
                </div>
                <button
                  type="button"
                  className="account-remove"
                  disabled={busy}
                  onClick={() => void removeFavorite(favorite.vehicleId)}
                >
                  Quitar
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="account-card account-card-searches" aria-labelledby="busquedas">
        <h2 id="busquedas">Búsquedas guardadas <span className="account-count">{visibleSearches.length}</span></h2>
        {visibleSearches.length === 0 ? (
          <p className="detail-meta">
            Todavía no tenés búsquedas guardadas. Podés explorar el stock y volver
            cuando quieras a una búsqueda que hayas guardado.
            {" "}<Link href="/stock">Explorar stock</Link>.
          </p>
        ) : (
          <ul className="account-list">
            {visibleSearches.map((search) => (
              <li key={search.id}>
                <div>
                  <Link href={`/stock?${new URLSearchParams({
                    q: typeof search.query.make === "string" ? search.query.make : "",
                  }).toString()}`}>
                    <strong>{search.name}</strong>
                  </Link>
                  <small>
                    {searchSummary(search.query)}
                    {Object.keys(search.query).some((key) => key !== "make")
                      ? " · Al abrir el catálogo se busca la marca; los demás criterios quedan como referencia."
                      : ""}
                  </small>
                </div>
                <button
                  type="button"
                  className="account-remove"
                  disabled={busy}
                  onClick={() => void removeSearch(search.id)}
                >
                  Quitar
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <details className="account-secondary">
        <summary>Datos y preferencias</summary>
        <section className="account-card account-card-profile" aria-labelledby="perfil">
          <h2 id="perfil">Tus datos</h2>
          <form className="lead-form" onSubmit={saveProfile}>
            <label>Nombre y apellido<input name="name" defaultValue={account.name} required minLength={2} /></label>
            <label>Teléfono / WhatsApp<input name="phone" defaultValue={account.phone ?? ""} inputMode="tel" /></label>
            <p className="detail-meta">Correo: {account.email}</p>
            <button className="primary-button" disabled={busy}>Guardar datos <span>→</span></button>
          </form>
        </section>
        <section className="account-card account-card-preferences" aria-labelledby="preferencias">
          <h2 id="preferencias">Qué estás buscando</h2>
          <p className="detail-meta">Sirve para que el vendedor te proponga unidades acordes. No calcula una cuota ni reserva nada.</p>
          <form className="lead-form" onSubmit={savePreferences}>
            <label>Presupuesto disponible<input name="budget" inputMode="numeric" defaultValue={preferences.budgetCents ? String(preferences.budgetCents / 100) : ""} placeholder="8.000.000" /></label>
            <label>Cuota máxima que podés pagar<input name="monthly" inputMode="numeric" defaultValue={preferences.maxMonthlyPaymentCents ? String(preferences.maxMonthlyPaymentCents / 100) : ""} placeholder="600.000" /></label>
            <label>Marcas que te interesan<input name="makes" defaultValue={preferences.preferredMakes.join(", ")} placeholder="Toyota, Volkswagen" /></label>
            <fieldset className="account-choices"><legend>Tipo de vehículo</legend>{BODY_TYPES.map((type) => <label key={type} className="consent-check"><input type="checkbox" name={`body-${type}`} defaultChecked={preferences.preferredBodyTypes.includes(type)} />{" "}{type === "auto" ? "Auto" : type === "suv" ? "SUV" : "Pick-up"}</label>)}</fieldset>
            <h3 className="account-subtitle">Tu vehículo actual</h3>
            <label>Marca<input name="currentMake" defaultValue={String(currentVehicle.make ?? "")} /></label>
            <label>Modelo<input name="currentModel" defaultValue={String(currentVehicle.model ?? "")} /></label>
            <label>Año<input name="currentYear" inputMode="numeric" defaultValue={currentVehicle.year ? String(currentVehicle.year) : ""} /></label>
            <label>Kilómetros<input name="currentKm" inputMode="numeric" defaultValue={currentVehicle.mileageKm ? String(currentVehicle.mileageKm) : ""} /></label>
            <button className="primary-button" disabled={busy}>Guardar preferencias <span>→</span></button>
          </form>
        </section>
      </details>

      <details className="account-secondary">
        <summary>Seguridad</summary>
        <section className="account-card account-card-security" aria-labelledby="seguridad">
          <h2 id="seguridad">Contraseña</h2>
          <form className="lead-form" onSubmit={savePassword}>
            <label>Contraseña actual<input name="currentPassword" type="password" autoComplete="current-password" required /></label>
            <label>Contraseña nueva<input name="newPassword" type="password" autoComplete="new-password" required minLength={10} /></label>
            <p className="detail-meta">Al cambiarla se cierran las sesiones abiertas en otros dispositivos.</p>
            <button className="primary-button" disabled={busy}>Cambiar contraseña <span>→</span></button>
          </form>
        </section>
      </details>
    </div>
  );
}
