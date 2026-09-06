"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { VehicleCard } from "./VehicleCard";
import type { PublicVehicleView } from "@/lib/server/public-data";

type Currency = "ALL" | "ARS" | "USD";
type Sort = "recommended" | "price-asc" | "price-desc" | "year-desc";

const currencies: Currency[] = ["ALL", "ARS", "USD"];
const sortOptions: { value: Sort; label: string }[] = [
  { value: "recommended", label: "Más relevantes" },
  { value: "price-asc", label: "Menor precio" },
  { value: "price-desc", label: "Mayor precio" },
  { value: "year-desc", label: "Más nuevos" },
];

function validCurrency(value: string | null): Currency {
  return currencies.includes(value as Currency) ? (value as Currency) : "ALL";
}

function validSort(value: string | null): Sort {
  return sortOptions.some((option) => option.value === value) ? (value as Sort) : "recommended";
}

export default function StockCatalog({ vehicles }: { vehicles: readonly PublicVehicleView[] }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const q = params.get("q") ?? "";
  const currency = validCurrency(params.get("currency"));
  const requestedSort = validSort(params.get("sort"));
  const sort = currency === "ALL" && requestedSort.startsWith("price-") ? "recommended" : requestedSort;
  const presentCurrencies = currencies.filter((item) => item === "ALL" || vehicles.some((vehicle) => vehicle.currency === item) || item === currency);

  const update = (changes: Record<string, string>) => {
    const next = new URLSearchParams(params.toString());
    Object.entries(changes).forEach(([key, value]) => value ? next.set(key, value) : next.delete(key));
    const url = `${pathname}${next.toString() ? `?${next}` : ""}`;
    window.history.pushState(null, "", url);
  };

  const filtered = useMemo(() => {
    const query = q.trim().toLocaleLowerCase();
    const visible = vehicles.filter((vehicle) => {
      const matchesQuery = !query || `${vehicle.name} ${vehicle.year}`.toLocaleLowerCase().includes(query);
      return matchesQuery && (currency === "ALL" || vehicle.currency === currency);
    });
    return [...visible].sort((a, b) => {
      if (sort === "year-desc") return Number(b.year) - Number(a.year);
      if (sort === "price-asc" && currency !== "ALL") return a.priceCents - b.priceCents;
      if (sort === "price-desc" && currency !== "ALL") return b.priceCents - a.priceCents;
      return 0;
    });
  }, [currency, q, sort, vehicles]);

  const hasFilters = Boolean(q || currency !== "ALL" || sort !== "recommended");
  return (
    <section className="catalog" aria-label="Catálogo de vehículos">
      <div className="catalog-filters">
        <form onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          update({ q: String(form.get("q") ?? "").trim() });
        }}>
          <label htmlFor="catalog-query">Buscar por marca, modelo o año</label>
          <div className="catalog-search-row">
            <input id="catalog-query" key={q} name="q" type="search" defaultValue={q} placeholder="Ej. Corolla o 2021" />
            <button type="submit">Buscar</button>
          </div>
        </form>
        <label>
          Moneda
          <select value={currency} onChange={(event) => update({ currency: event.target.value })}>
            {presentCurrencies.map((item) => (
              <option key={item} value={item}>{item === "ALL" ? "Todas las monedas" : item}</option>
            ))}
          </select>
        </label>
        <label>
          Ordenar
          <select value={sort} onChange={(event) => update({ sort: event.target.value })}>
            {sortOptions.map((option) => (
              <option key={option.value} value={option.value} disabled={currency === "ALL" && option.value.startsWith("price-")}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="catalog-summary">
        <strong role="status" aria-live="polite">
          {filtered.length} {filtered.length === 1 ? "vehículo publicado" : "vehículos publicados"}
        </strong>
        {hasFilters ? <button type="button" onClick={() => update({ q: "", currency: "", sort: "" })}>Limpiar filtros</button> : null}
      </div>
      {currency === "ALL" ? (
        <p className="catalog-note">Elegí una moneda para ordenar los autos por precio.</p>
      ) : null}
      {filtered.length > 0 ? (
        <div className="vehicle-grid stock-grid">
          {filtered.map((vehicle) => <VehicleCard key={vehicle.slug} vehicle={vehicle} />)}
        </div>
      ) : (
        <div className="catalog-empty">
          <h2>{vehicles.length === 0 ? "Todavía no hay unidades publicadas" : "No encontramos vehículos con esos filtros"}</h2>
          <p>Probá con otro modelo, año o moneda, o consultanos por próximos ingresos.</p>
          {hasFilters ? <button type="button" onClick={() => update({ q: "", currency: "", sort: "" })}>Ver todo el stock</button> : null}
          <Link href="/contacto">Consultar disponibilidad</Link>
        </div>
      )}
    </section>
  );
}
