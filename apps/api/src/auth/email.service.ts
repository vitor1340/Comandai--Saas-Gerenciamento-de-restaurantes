import { Injectable } from '@nestjs/common';
import { Resend } from 'resend';
import { exigirVariavelAmbiente } from '../common/env.util';

@Injectable()
export class EmailService {
  private readonly resend = new Resend(
    exigirVariavelAmbiente('RESEND_API_KEY'),
  );
  private readonly remetente = exigirVariavelAmbiente('RESEND_FROM_EMAIL');

  async enviarEmailRedefinicaoSenha(
    destinatario: string,
    link: string,
  ): Promise<void> {
    await this.enviar(destinatario, 'Redefinição de senha - Comandaí', [
      'Recebemos uma solicitação para redefinir sua senha.',
      '',
      `Clique no link abaixo (válido por 30 minutos):`,
      link,
      '',
      'Se você não pediu isso, pode ignorar este e-mail.',
    ]);
  }

  async enviarEmailVerificacao(
    destinatario: string,
    link: string,
  ): Promise<void> {
    await this.enviar(destinatario, 'Confirme seu e-mail - Comandaí', [
      'Bem-vindo ao Comandaí!',
      '',
      'Confirme seu e-mail clicando no link abaixo (válido por 24 horas):',
      link,
      '',
      'Se você não criou uma conta no Comandaí, pode ignorar este e-mail.',
    ]);
  }

  private async enviar(
    destinatario: string,
    assunto: string,
    linhas: string[],
  ): Promise<void> {
    const { error } = await this.resend.emails.send({
      from: this.remetente,
      to: destinatario,
      subject: assunto,
      text: linhas.join('\n'),
    });

    if (error) {
      throw new Error(
        `Falha ao enviar e-mail via Resend: ${error.name} - ${error.message}`,
      );
    }
  }
}
