"use client";
import Link from "next/link";
export default function Error({reset}:{error:Error&{digest?:string};reset:()=>void}){return <main className="state-page"><span className="state-code">!</span><p className="eyebrow">ALGO SALIÓ MAL</p><h1>No pudimos cargar esta sección.</h1><p>Intentá nuevamente o volvé al inicio para seguir buscando.</p><div className="state-actions"><button className="primary-button" onClick={()=>reset()}>Reintentar <span>↻</span></button><Link className="secondary-button" href="/">Ir al inicio</Link></div></main>}
