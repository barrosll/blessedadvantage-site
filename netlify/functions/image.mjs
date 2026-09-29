// Serve as fotos carregadas no /admin
import { imageStore } from "../lib/catalog.mjs";

export const config = { path: "/img/:key" };

export default async (req, context) => {
  const key = context.params.key;
  if (!/^[a-z0-9-]+$/i.test(key)) return new Response("Não encontrado", { status: 404 });

  const entry = await imageStore().getWithMetadata(key, { type: "arrayBuffer" });
  if (!entry) return new Response("Não encontrado", { status: 404 });

  return new Response(entry.data, {
    headers: {
      "Content-Type": (entry.metadata && entry.metadata.type) || "image/jpeg",
      // Cada foto tem um nome único, por isso pode ficar em cache para sempre
      "Cache-Control": "public, max-age=31536000, immutable"
    }
  });
};
