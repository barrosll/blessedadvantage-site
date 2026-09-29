// Modo manutenção: com MAINTENANCE_MODE=1 a loja mostra a página "Voltamos em breve".
// A gestão (/admin), as APIs e as imagens continuam a funcionar.
export default async (req, context) => {
  if (Netlify.env.get("MAINTENANCE_MODE") !== "1") return context.next();
  return new URL("/manutencao.html", req.url);
};

export const config = {
  path: "/*",
  // Quem já comprou continua a poder ver a encomenda (página Obrigado e "A minha encomenda")
  excludedPath: ["/admin*", "/api/*", "/img/*", "/images/*", "/styles.css", "/manutencao.html", "/encomenda.html", "/encomenda.js", "/sucesso.html"]
};
