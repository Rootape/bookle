/** @type {import('next').NextConfig} */
const nextConfig = {
  // Static export: gera HTML/JS estáticos, sem precisar de um processo Node
  // rodando em produção. A própria API FastAPI (ou Tailscale + qualquer
  // servidor estático) pode servir o resultado. Ideal pro setup single-user.
  output: 'export',

  // necessário pro static export quando há rotas dinâmicas ([id])
  trailingSlash: true,

  // o leitor não usa o otimizador de imagem do Next (que exige servidor)
  images: { unoptimized: true },
};

export default nextConfig;
