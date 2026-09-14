import Image from "next/image";
import Link from "next/link";
import { PanelNavigation } from "./PanelNavigation";

export function PanelShell({
  children,
  title,
  subtitle,
}: {
  children: React.ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="panel-app">
      <aside className="panel-sidebar">
        <Link className="panel-brand" href="/panel" aria-label="Ir al resumen del panel">
          <Image className="panel-logo" src="/logo.jpg" alt="Jesús Díaz Automotores" width={801} height={253} priority />
          <small>PANEL INTERNO</small>
        </Link>
        <PanelNavigation />
        <div className="panel-user">
          <span className="avatar">JD</span>
          <span><strong>Equipo JD</strong><small>Acceso protegido</small></span>
        </div>
      </aside>
      <main className="panel-main" id="panel-content">
        <header className="panel-topbar">
          <div><p className="panel-kicker">PANEL OPERATIVO</p><h1>{title}</h1><p>{subtitle}</p></div>
          <Link className="panel-site-link" href="/">Ver sitio ↗</Link>
        </header>
        {children}
      </main>
    </div>
  );
}
