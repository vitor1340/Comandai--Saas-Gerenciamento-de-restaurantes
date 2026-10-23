import type { RefreshResponseDTO } from '@comandai/shared-types';
import { clearSessionCookie, setSessionCookie } from './auth-cookie';
import { useAuthStore } from '@/store/auth-store';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    // Ex.: EMAIL_NAO_VERIFICADO, DOCUMENTO_PENDENTE, CONTA_SUSPENSA (ver
    // ContaLiberadaGuard na API).
    public codigo?: string,
  ) {
    super(message);
  }
}

// Evita que múltiplas requisições que expiram ao mesmo tempo disparem
// refreshes concorrentes: como o refresh token roda em rotação (cada uso
// invalida o anterior), duas chamadas simultâneas fariam a segunda ser
// tratada como reuso de token revogado e derrubaria a sessão inteira.
let refreshEmAndamento: Promise<string | null> | null = null;

function renovarAccessToken(): Promise<string | null> {
  if (!refreshEmAndamento) {
    refreshEmAndamento = (async () => {
      try {
        const resposta = await fetch('/api/auth/refresh', { method: 'POST' });
        if (!resposta.ok) return null;
        const dados: RefreshResponseDTO & { accessToken: string } = await resposta.json();
        useAuthStore.getState().setAccessToken(dados.accessToken);
        setSessionCookie(dados.accessToken);
        return dados.accessToken;
      } catch {
        return null;
      } finally {
        refreshEmAndamento = null;
      }
    })();
  }
  return refreshEmAndamento;
}

function encerrarSessaoExpirada() {
  useAuthStore.getState().clearSession();
  clearSessionCookie();
}

// O painel deixa o usuário navegar mesmo sem plano ativo (ver ContaStatusBanner)
// — só ações de escrita são bloqueadas (402/403, ContaLiberadaGuard). Por isso não
// redireciona pra /planos aqui: só repassa a mensagem amigável que o backend
// já manda (ex.: "Seu teste grátis acabou...") pra quem chamou decidir como
// mostrar o erro, em vez de um texto genérico de HTTP.
async function lancarErroDaResposta(response: Response, path: string): Promise<never> {
  const corpo = await corpoJson(response);
  const mensagem = extrairMensagem(corpo) ?? `Falha ao chamar ${path} (${response.status})`;
  const codigo =
    corpo && typeof corpo === 'object' && 'codigo' in corpo && typeof corpo.codigo === 'string'
      ? corpo.codigo
      : undefined;
  throw new ApiError(mensagem, response.status, codigo);
}

async function corpoJson(response: Response): Promise<unknown> {
  try {
    return await response.clone().json();
  } catch {
    // corpo não é JSON (ou já foi consumido)
    return null;
  }
}

function extrairMensagem(corpo: unknown): string | null {
  if (corpo && typeof corpo === 'object' && 'message' in corpo) {
    const valor = (corpo as { message: unknown }).message;
    if (typeof valor === 'string') return valor;
    // ValidationPipe devolve uma lista — mostra a primeira.
    if (Array.isArray(valor) && typeof valor[0] === 'string') return valor[0];
  }
  return null;
}

/** Mensagem amigável que a API mandou no corpo do erro, se houver. */
export async function mensagemDeErro(response: Response): Promise<string | null> {
  return extrairMensagem(await corpoJson(response));
}

export async function apiFetch<T>(
  path: string,
  token: string | undefined,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
    cache: 'no-store',
  });

  if (response.status === 401 && typeof window !== 'undefined' && token) {
    const novoToken = await renovarAccessToken();
    if (novoToken) {
      return apiFetch<T>(path, novoToken, init);
    }
    encerrarSessaoExpirada();
  }

  if (!response.ok) {
    return lancarErroDaResposta(response, path);
  }

  return response.json() as Promise<T>;
}

export async function apiUpload<T>(
  path: string,
  token: string | undefined,
  formData: FormData,
): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: formData,
    cache: 'no-store',
  });

  if (response.status === 401 && typeof window !== 'undefined' && token) {
    const novoToken = await renovarAccessToken();
    if (novoToken) {
      return apiUpload<T>(path, novoToken, formData);
    }
    encerrarSessaoExpirada();
  }

  if (!response.ok) {
    return lancarErroDaResposta(response, path);
  }

  return response.json() as Promise<T>;
}
