'use client';

import { useEffect, useRef } from 'react';

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
const URL_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

// Sem site key (dev local), o captcha fica desligado — a API também pula a
// verificação quando não tem TURNSTILE_SECRET_KEY fora de produção.
export const TURNSTILE_ATIVO = Boolean(SITE_KEY);

interface TurnstileApi {
  render: (
    elemento: HTMLElement,
    opcoes: {
      sitekey: string;
      callback: (token: string) => void;
      'expired-callback': () => void;
      'error-callback': () => void;
      language: string;
    },
  ) => string;
  remove: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let carregamentoScript: Promise<void> | null = null;

function carregarScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (!carregamentoScript) {
    carregamentoScript = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = URL_SCRIPT;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        carregamentoScript = null;
        reject(new Error('Falha ao carregar o Turnstile'));
      };
      document.head.appendChild(script);
    });
  }
  return carregamentoScript;
}

/**
 * Captcha anti-robô (Cloudflare Turnstile). O token é de uso único: depois
 * de um envio que falhou, o pai troca a `key` do componente pra gerar outro.
 */
export function Turnstile({ onToken }: { onToken: (token: string | null) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const onTokenRef = useRef(onToken);

  useEffect(() => {
    onTokenRef.current = onToken;
  }, [onToken]);

  useEffect(() => {
    if (!SITE_KEY || !container.current) return;
    let widgetId: string | null = null;
    let cancelado = false;

    carregarScript()
      .then(() => {
        if (cancelado || !container.current || !window.turnstile) return;
        widgetId = window.turnstile.render(container.current, {
          sitekey: SITE_KEY,
          callback: (token) => onTokenRef.current(token),
          'expired-callback': () => onTokenRef.current(null),
          'error-callback': () => onTokenRef.current(null),
          language: 'pt-br',
        });
      })
      .catch(() => onTokenRef.current(null));

    return () => {
      cancelado = true;
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, []);

  if (!SITE_KEY) return null;
  return <div ref={container} className="flex min-h-[65px] justify-center" />;
}
