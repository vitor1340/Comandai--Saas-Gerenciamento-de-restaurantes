import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";
const isProd = process.env.NODE_ENV === "production";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api";
const apiOrigin = new URL(apiUrl).origin;
const wsOrigin = apiOrigin.replace(/^http/, "ws");

// Sem nonce por escolha deliberada: CSP com nonce exige renderização
// dinâmica em toda a aplicação (desativa páginas estáticas/ISR) — trade-off
// grande demais pra esta correção pontual. `unsafe-inline` em script/style
// é necessário porque o Next injeta scripts inline pro bootstrap de
// hidratação e este app usa `style={{...}}` inline em vários componentes.
const cspHeader = `
  default-src 'self';
  script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com${isDev ? " 'unsafe-eval'" : ""};
  frame-src https://challenges.cloudflare.com;
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: blob: https:;
  font-src 'self';
  connect-src 'self' ${apiOrigin} ${wsOrigin};
  object-src 'none';
  base-uri 'self';
  form-action 'self';
  frame-ancestors 'none';
  ${isProd ? "upgrade-insecure-requests;" : ""}
`
  .replace(/\s{2,}/g, " ")
  .trim();

const nextConfig: NextConfig = {
  // Sem isso, o Next bloqueia (403) requisições de dev-assets vindas de uma
  // origem diferente de localhost — necessário pra testar via túnel ngrok.
  allowedDevOrigins: isDev ? ["aggregate-moneywise-eloquence.ngrok-free.dev"] : undefined,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: cspHeader },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
