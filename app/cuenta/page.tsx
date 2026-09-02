import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { LogoutButton } from "../_components/AccountActions";
import { AccountDashboard } from "../_components/AccountDashboard";
import { PublicShell } from "../_components/PublicShell";
import { readAccountDashboard } from "@/lib/server/account-api";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Mi cuenta | Jesús Díaz Automotores",
  description: "Tus favoritos, búsquedas guardadas, tasaciones y simulaciones.",
  // Es una pantalla privada por definición: no se indexa ni se difunde.
  robots: { index: false, follow: false },
};

function money(cents: number | null, currency = "ARS"): string {
  if (cents === null) return "a confirmar";
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function shortDate(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return "";
  return new Intl.DateTimeFormat("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(parsed));
}

export default async function AccountPage() {
  const data = await readAccountDashboard((await headers()).get("cookie"));
  if (!data) redirect("/cuenta/ingresar");
  const { account, preferences, favorites, searches, activity } = data;

  return (
    <PublicShell>
      <main id="contenido" className="public-page account-page">
        <div className="form-intro">
          <p className="eyebrow">TU CUENTA</p>
          <h1>Hola, {account.name.split(" ")[0]}</h1>
          <p>Acá queda lo que guardaste y lo que ya consultaste con nosotros.</p>
          <div className="account-logout"><LogoutButton /></div>
        </div>

        <section className="account-card" aria-labelledby="actividad">
          <h2 id="actividad">Tus consultas</h2>
          {!account.leadId ? (
            <p className="detail-meta">
              Todavía no vinculamos tu cuenta con una consulta. Cuando pidas una
              tasación o guardes una simulación, las vas a ver acá.{" "}
              <a href="/tasar-mi-usado">Pedir una tasación</a>.
            </p>
          ) : null}

          {activity.appraisals.length > 0 ? (
            <>
              <h3 className="account-subtitle">Tasaciones</h3>
              <ul className="account-list">
                {activity.appraisals.map((appraisal) => (
                  <li key={appraisal.publicCode}>
                    <div>
                      <strong>{appraisal.vehicleDescription}</strong>
                      <small>
                        Código {appraisal.publicCode} · {shortDate(appraisal.createdAt)} ·{" "}
                        {appraisal.status === "APPROVED"
                          ? `Rango orientativo ${money(appraisal.lowCents, appraisal.currency)} a ${money(appraisal.highCents, appraisal.currency)}`
                          : "En revisión del equipo"}
                      </small>
                    </div>
                  </li>
                ))}
              </ul>
              <p className="detail-meta">
                El rango es orientativo. La tasación final se hace presencialmente.
              </p>
            </>
          ) : null}

          {activity.simulations.length > 0 ? (
            <>
              <h3 className="account-subtitle">Simulaciones</h3>
              <ul className="account-list">
                {activity.simulations.map((simulation) => (
                  <li key={simulation.publicCode}>
                    <div>
                      <a href={`/simulaciones/${encodeURIComponent(simulation.publicCode)}`}>
                        <strong>{simulation.vehicleName ?? "Operación simulada"}</strong>
                      </a>
                      <small>
                        Código {simulation.publicCode} · {shortDate(simulation.createdAt)} ·{" "}
                        {money(simulation.effectivePriceCents, simulation.currency)}
                        {simulation.installmentCents !== null && simulation.termMonths !== null
                          ? ` · ${simulation.termMonths} cuotas de ${money(simulation.installmentCents, simulation.currency)}`
                          : ""}
                      </small>
                    </div>
                  </li>
                ))}
              </ul>
              <p className="detail-meta">
                Cada simulación conserva los importes con los que se calculó y
                vence en la fecha que informa su pantalla.
              </p>
            </>
          ) : null}
        </section>

        <AccountDashboard
          account={{
            name: account.name,
            email: account.email,
            phone: account.phoneNormalized,
            linkedToCrm: account.leadId !== null,
          }}
          preferences={{
            budgetCents: preferences.budgetCents,
            maxMonthlyPaymentCents: preferences.maxMonthlyPaymentCents,
            preferredMakes: preferences.preferredMakes,
            preferredBodyTypes: preferences.preferredBodyTypes,
            currentVehicle: preferences.currentVehicle,
          }}
          favorites={favorites.map((favorite) => ({
            vehicleId: favorite.vehicleId,
            slug: favorite.slug,
            make: favorite.make,
            model: favorite.model,
            trim: favorite.trim,
            year: favorite.year,
            mileageKm: favorite.mileageKm,
            priceCents: favorite.priceCents,
            currency: favorite.currency,
            status: favorite.status,
          }))}
          searches={searches.map((search) => ({
            id: search.id,
            name: search.name,
            query: search.query,
          }))}
        />
      </main>
    </PublicShell>
  );
}
