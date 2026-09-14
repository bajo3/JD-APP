"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  ["/panel", "Resumen", "⌂"],
  ["/panel/conversaciones", "Conversaciones", "◐"],
  ["/panel/leads", "Leads", "◌"],
  ["/panel/demandas", "Demanda", "◎"],
  ["/panel/stock", "Stock", "▣"],
  ["/panel/tasaciones", "Tasaciones", "◇"],
  ["/panel/consignaciones", "Consignaciones", "◈"],
  ["/panel/financiacion", "Financiación", "₿"],
  ["/panel/ofertas", "Ofertas", "✦"],
  ["/panel/configuracion", "Configuración", "⚙"],
] as const;

export function PanelNavigation() {
  const pathname = usePathname();

  return (
    <nav className="panel-nav" aria-label="Secciones del panel">
      {NAV_ITEMS.map(([href, label, icon]) => {
        const active = href === "/panel" ? pathname === href : pathname.startsWith(href);
        return (
          <Link href={href} key={href} className={active ? "is-active" : undefined} aria-current={active ? "page" : undefined}>
            <span aria-hidden="true">{icon}</span>
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
