import { BadRequestException, Injectable, Logger } from '@nestjs/common';

const URL_VERIFICACAO =
  'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * Captcha (Cloudflare Turnstile) nas rotas públicas de auth — barra
 * cadastro/login em massa por bot, que rate limit por IP sozinho não segura
 * (proxies rotativos). Sem TURNSTILE_SECRET_KEY fora de produção a
 * verificação é pulada, pra não travar dev local nem os testes e2e.
 */
@Injectable()
export class TurnstileService {
  private readonly logger = new Logger(TurnstileService.name);

  constructor() {
    if (
      process.env.NODE_ENV === 'production' &&
      !process.env.TURNSTILE_SECRET_KEY
    ) {
      throw new Error(
        'Variável de ambiente obrigatória ausente: TURNSTILE_SECRET_KEY',
      );
    }
  }

  async verificar(token: string | undefined, ip: string): Promise<void> {
    const segredo = process.env.TURNSTILE_SECRET_KEY;
    if (!segredo) {
      return;
    }

    if (!token) {
      throw new BadRequestException(
        'Verificação anti-robô falhou. Recarregue a página e tente de novo.',
      );
    }

    let sucesso = false;
    try {
      const resposta = await fetch(URL_VERIFICACAO, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          secret: segredo,
          response: token,
          remoteip: ip,
        }),
      });
      const dados = (await resposta.json()) as { success?: boolean };
      sucesso = dados.success === true;
    } catch (erro) {
      this.logger.error('Falha ao consultar o Turnstile', erro);
    }

    if (!sucesso) {
      throw new BadRequestException(
        'Verificação anti-robô falhou. Recarregue a página e tente de novo.',
      );
    }
  }
}
