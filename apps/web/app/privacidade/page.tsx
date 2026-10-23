import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthBrandHeader } from '@/components/shared/AuthBrandHeader';

export const metadata: Metadata = {
  title: 'Política de Privacidade | Comandaí',
};

export default function PoliticaPrivacidadePage() {
  return (
    <main className="flex min-h-screen justify-center bg-page px-4 py-12">
      <div className="w-full max-w-2xl rounded-2xl border border-border bg-surface p-8 shadow-sm">
        <AuthBrandHeader />

        <h1 className="mb-1 text-2xl font-bold text-ink-primary">Política de Privacidade</h1>
        <p className="mb-8 text-sm text-ink-secondary">Última atualização: [DATA]</p>

        <div className="space-y-8 text-sm leading-relaxed text-ink-secondary">
          <section>
            <p>
              Esta Política de Privacidade descreve como o <strong>Comandaí</strong>{' '}
              (&quot;nós&quot;), plataforma de gestão de restaurantes operada por{' '}
              <strong>[RAZÃO SOCIAL]</strong>, inscrita no CNPJ sob o nº <strong>[CNPJ]</strong>,
              coleta, usa, compartilha e protege dados pessoais, em conformidade com a Lei Geral
              de Proteção de Dados (Lei nº 13.709/2018 — LGPD).
            </p>
            <p className="mt-2">
              Esta política se aplica tanto aos donos e equipes de restaurantes que usam o painel
              administrativo do Comandaí (&quot;Parceiros&quot;) quanto aos clientes finais que
              fazem pedidos pela loja pública de um restaurante parceiro (&quot;Clientes&quot;).
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-ink-primary">1. Quais dados coletamos</h2>
            <p className="mb-2 font-medium text-ink-primary">De Parceiros (donos e equipe do restaurante):</p>
            <ul className="mb-3 list-disc space-y-1 pl-5">
              <li>Nome, e-mail e senha (ou identidade vinculada via login com Google);</li>
              <li>
                CPF ou CNPJ do responsável pelo restaurante, usado para identificar o cadastro e
                limitar o teste grátis a um por documento;
              </li>
              <li>Dados do restaurante: nome, endereço, WhatsApp, horário de funcionamento, cardápio e imagens enviadas;</li>
              <li>
                Dados de conexão com o Mercado Pago (token de acesso OAuth, armazenado
                criptografado), quando o Parceiro conecta uma conta para receber pagamentos
                online;
              </li>
              <li>
                Registros técnicos de acesso (endereço IP de cadastro e de login, navegador, data e
                hora), usados também para prevenir fraude e abuso.
              </li>
            </ul>
            <p className="mb-2 font-medium text-ink-primary">De Clientes (quem faz pedidos na loja pública):</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>Nome informado no momento do pedido;</li>
              <li>Itens do pedido, forma de entrega e valor;</li>
              <li>Dados de pagamento, quando o pedido é pago online — processados diretamente pelo Mercado Pago; o Comandaí não armazena número de cartão nem dados sensíveis de pagamento.</li>
            </ul>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-ink-primary">2. Como usamos os dados</h2>
            <ul className="list-disc space-y-1 pl-5">
              <li>Viabilizar o cadastro, login e uso do painel administrativo pelos Parceiros;</li>
              <li>Processar e acompanhar pedidos feitos por Clientes na loja pública de um restaurante;</li>
              <li>Processar pagamentos online através da integração com o Mercado Pago;</li>
              <li>Enviar e-mails operacionais (ex.: recuperação de senha) através do provedor Resend;</li>
              <li>Gerar métricas e relatórios de vendas para o próprio Parceiro dentro do painel;</li>
              <li>Cumprir obrigações legais e prevenir fraudes.</li>
            </ul>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-ink-primary">3. Com quem compartilhamos dados</h2>
            <p className="mb-2">
              Não vendemos dados pessoais. Compartilhamos dados apenas com prestadores de serviço
              estritamente necessários para operar a plataforma:
            </p>
            <ul className="list-disc space-y-1 pl-5">
              <li><strong>Mercado Pago</strong> — processamento de pagamentos online (Pix e cartão);</li>
              <li><strong>Supabase</strong> — armazenamento de imagens (logos e fotos de produtos);</li>
              <li><strong>Resend</strong> — envio de e-mails transacionais (ex.: redefinição de senha);</li>
              <li><strong>Google</strong> — autenticação via login social (OAuth), quando o Parceiro opta por essa forma de login;</li>
              <li><strong>Neon (PostgreSQL)</strong> — hospedagem do banco de dados da aplicação.</li>
            </ul>
            <p className="mt-2">
              Cada um desses serviços possui sua própria política de privacidade e é contratualmente
              exigido a proteger os dados tratados em nosso nome.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-ink-primary">4. Base legal para o tratamento</h2>
            <p>
              Tratamos dados pessoais com base na execução de contrato (para viabilizar o uso da
              plataforma e a entrega de pedidos), no legítimo interesse (para segurança e melhoria
              do serviço) e, quando aplicável, no consentimento do titular.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-ink-primary">5. Retenção e exclusão de dados</h2>
            <p>
              Mantemos os dados pelo tempo necessário para cumprir as finalidades descritas nesta
              política ou por prazo maior quando exigido por lei (ex.: obrigações fiscais). O
              Parceiro pode solicitar a exclusão de sua conta e dos dados associados a qualquer
              momento pelo contato indicado abaixo.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-ink-primary">6. Direitos do titular de dados</h2>
            <p className="mb-2">
              Nos termos da LGPD, você tem direito a confirmar a existência de tratamento, acessar,
              corrigir, anonimizar, portar ou solicitar a exclusão dos seus dados pessoais, bem como
              revogar consentimentos previamente concedidos. Para exercer esses direitos, entre em
              contato pelo e-mail indicado na seção &quot;Contato&quot;.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-ink-primary">7. Segurança da informação</h2>
            <p>
              Adotamos medidas técnicas e organizacionais para proteger os dados pessoais, incluindo
              criptografia de credenciais sensíveis, controle de acesso por autenticação e,
              opcionalmente, autenticação de dois fatores para contas de Parceiros. Nenhum sistema é
              inteiramente livre de risco; em caso de incidente de segurança relevante,
              notificaremos os titulares afetados e as autoridades competentes conforme exigido por
              lei.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-ink-primary">8. Cookies e tecnologias semelhantes</h2>
            <p>
              Usamos cookies estritamente necessários para manter sua sessão autenticada no painel
              administrativo. Não usamos cookies de rastreamento publicitário.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-ink-primary">9. Alterações nesta política</h2>
            <p>
              Podemos atualizar esta política periodicamente. Alterações relevantes serão
              comunicadas pelos canais habituais de contato com os Parceiros.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-ink-primary">10. Contato</h2>
            <p>
              Dúvidas sobre esta política ou sobre o tratamento dos seus dados pessoais podem ser
              enviadas para <strong>[E-MAIL DE CONTATO]</strong>.
            </p>
          </section>
        </div>

        <p className="mt-8 text-center text-sm text-ink-secondary">
          <Link href="/" className="font-semibold text-brand hover:underline">
            Voltar ao início
          </Link>
        </p>
      </div>
    </main>
  );
}
