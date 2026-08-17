import type { MetadataRoute } from "next";
export default function sitemap(): MetadataRoute.Sitemap { const base=process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/,"")||""; return ["/","/stock","/tasar-mi-usado","/que-auto-me-llevo","/oferta-del-dia","/contacto"].map(path=>({url:`${base}${path}`,changeFrequency:path==="/stock"?"daily":"weekly",priority:path==="/"?1:.7})); }
