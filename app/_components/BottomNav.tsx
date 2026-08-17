import Link from "next/link";
export function BottomNav(){return <nav className="bottom-nav" aria-label="Accesos rápidos"><Link href="/"><span>⌂</span>Inicio</Link><Link href="/stock"><span>▣</span>Stock</Link><Link href="/que-auto-me-llevo"><span>?</span>Ayuda</Link><a href="https://wa.me/5492494587046"><span>◉</span>WhatsApp</a></nav>}
