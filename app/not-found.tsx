import Link from "next/link";
export default function NotFound(){return <main className="state-page"><span className="state-code">404</span><p className="eyebrow">PÁGINA NO ENCONTRADA</p><h1>Este camino no lleva a ningún auto.</h1><p>La página que buscás no existe o fue movida.</p><Link className="primary-button" href="/">Volver al inicio <span>→</span></Link></main>}
