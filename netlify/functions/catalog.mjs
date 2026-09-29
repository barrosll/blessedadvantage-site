// Catálogo público usado pela loja
import { loadCatalog, publicCatalog } from "../lib/catalog.mjs";

export const config = { path: "/api/catalog" };

export default async () => {
  const catalog = publicCatalog(await loadCatalog());
  return new Response(JSON.stringify(catalog), {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
};
