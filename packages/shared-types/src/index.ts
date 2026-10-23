export type CanalVenda = 'CARDAPIO_DIGITAL' | 'WHATSAPP' | 'QR_CODE_SALAO';
export type TipoEntrega = 'DELIVERY' | 'RETIRADA' | 'SALAO';
export type TipoAtendimento = 'DELIVERY_E_FISICA' | 'SOMENTE_DELIVERY' | 'SOMENTE_FISICA';
export type StatusPedido =
  | 'NOVO'
  | 'CONFIRMADO'
  | 'EM_PREPARO'
  | 'PRONTO'
  | 'SAIU_PARA_ENTREGA'
  | 'ENTREGUE'
  | 'CANCELADO';

export interface UsuarioDTO {
  id: string;
  nome: string;
  email: string;
  cargo: string;
}

export interface UsuarioMeDTO extends UsuarioDTO {
  restauranteId: string;
  doisFatoresAtivo: boolean;
  emailVerificado: boolean;
  superAdmin: boolean;
}

export interface LoginResponseDTO {
  accessToken: string;
  usuario: UsuarioDTO;
}

export interface LoginComRefreshResponseDTO extends LoginResponseDTO {
  refreshToken: string;
}

export interface RefreshResponseDTO {
  accessToken: string;
  refreshToken: string;
}

export interface RequerDoisFatoresDTO {
  requiresTwoFactor: true;
  tempToken: string;
}

export type LoginResultDTO = LoginResponseDTO | RequerDoisFatoresDTO;

export type LoginComRefreshResultDTO =
  | LoginComRefreshResponseDTO
  | RequerDoisFatoresDTO;

export interface SetupDoisFatoresDTO {
  otpauthUri: string;
  qrCodeDataUrl: string;
}

export interface AtivarDoisFatoresResponseDTO {
  backupCodes: string[];
}

export type StatusPlano = 'TRIALING' | 'ACTIVE' | 'EXPIRED' | 'PAST_DUE' | 'CANCELED';

export interface RestauranteMeDTO {
  id: string;
  nome: string;
  slug: string;
  plano: string;
  statusPlano: StatusPlano;
  trialEndsAt: string;
  diasRestantesTeste: number;
  aberto: boolean;
  whatsapp: string | null;
  tagline: string | null;
  logoUrl: string | null;
  corDestaque: string | null;
  tipoAtendimento: TipoAtendimento;
  endereco: string | null;
  horarioFuncionamento: string | null;
  diferenciais: string[];
  pedidosNovosCount: number;
  mercadoPagoConectado: boolean;
  faixaAssinatura: FaixaAssinatura | null;
  // Cadastro via Google ainda sem CPF/CNPJ (onboarding pendente).
  documentoPendente: boolean;
  suspenso: boolean;
}

export interface CompletarCadastroDTO {
  documento: string;
  nomeRestaurante: string;
}

export interface AdminRestauranteDTO {
  id: string;
  nome: string;
  slug: string;
  documento: string | null;
  emailDono: string | null;
  emailVerificado: boolean;
  loginGoogle: boolean;
  statusPlano: StatusPlano;
  trialEndsAt: string;
  suspenso: boolean;
  ipCadastro: string | null;
  pedidosCount: number;
  produtosCount: number;
  createdAt: string;
}

export interface AdminRestaurantesPaginaDTO {
  total: number;
  pagina: number;
  itensPorPagina: number;
  itens: AdminRestauranteDTO[];
}

export interface AtualizarRestauranteAdminDTO {
  suspenso?: boolean;
  estenderTrialDias?: number;
}

export type FaixaAssinatura = 'ATE_150' | 'DE_151_A_250' | 'ACIMA_250';

export interface AssinaturaAtualDTO {
  temAssinatura: boolean;
  faixaAssinatura: FaixaAssinatura | null;
  statusAssinatura: StatusPlano;
  precoCentavos: number | null;
}

export interface IniciarAssinaturaDTO {
  faixa: FaixaAssinatura;
}

export interface IniciarAssinaturaResponseDTO {
  initPoint: string;
}

export interface TrocarFaixaAssinaturaDTO {
  faixa: FaixaAssinatura;
}

export type StatusPagamento = 'PENDENTE' | 'APROVADO' | 'RECUSADO' | 'CANCELADO';

export interface PagamentoResumoDTO {
  status: StatusPagamento;
  metodoPagamento: string | null;
}

export interface ConectarMercadoPagoDTO {
  url: string;
}

export interface CriarPagamentoPedidoDTO {
  initPoint: string;
}

export interface UpdateRestauranteDTO {
  nome?: string;
  whatsapp?: string;
  aberto?: boolean;
  tagline?: string;
  logoUrl?: string;
  corDestaque?: string;
  tipoAtendimento?: TipoAtendimento;
  endereco?: string;
  horarioFuncionamento?: string;
  diferenciais?: string[];
}

export interface LojaProdutoDTO {
  id: string;
  nome: string;
  descricao: string | null;
  precoCentavos: number;
  imagemUrl: string | null;
}

export interface LojaCategoriaDTO {
  id: string;
  nome: string;
  // true só para a categoria virtual "Outros" (produtos sem categoria
  // agrupados) — nunca compare `id` como string mágica, use esta flag.
  sintetica: boolean;
  produtos: LojaProdutoDTO[];
}

export interface LojaDTO {
  nome: string;
  slug: string;
  aberto: boolean;
  whatsapp: string | null;
  mercadoPagoConectado: boolean;
  tagline: string | null;
  logoUrl: string | null;
  corDestaque: string | null;
  tipoAtendimento: TipoAtendimento;
  endereco: string | null;
  horarioFuncionamento: string | null;
  diferenciais: string[];
  produtoDestaque: LojaProdutoDTO | null;
  categorias: LojaCategoriaDTO[];
}

export interface DashboardSummaryDTO {
  dataFormatada: string;
  saudacao: string;
  vendasHoje: { valorCentavos: number; variacaoPercentual: number };
  pedidosHoje: { quantidade: number; variacaoAbsoluta: number };
  ticketMedio: { valorCentavos: number; variacaoPercentual: number };
  tempoMedioPreparo: { minutos: number; variacaoMinutos: number };
  ultimoPedidoNovo: { numero: number; clienteNome: string; valorTotalCentavos: number } | null;
}

export interface SalesPerformanceDTO {
  totalPeriodoCentavos: number;
  variacaoPercentual: number;
  serie: { data: string; diaSemana: string; valorCentavos: number }[];
}

export interface SalesChannelsDTO {
  totalPedidos: number;
  canais: { canal: CanalVenda; quantidade: number; percentual: number }[];
}

export interface PedidoResumoDTO {
  id: string;
  numero: number;
  clienteNome: string;
  itensCount: number;
  tipoEntrega: TipoEntrega;
  status: StatusPedido;
  valorTotalCentavos: number;
  createdAt: string;
}

export interface ItemPedidoDTO {
  id: string;
  produtoId: string;
  produto: { id: string; nome: string; imagemUrl: string | null };
  quantidade: number;
  precoUnitarioCentavos: number;
  observacao: string | null;
}

export interface PedidoDetalheDTO {
  id: string;
  numero: number;
  clienteNome: string;
  canal: CanalVenda;
  tipoEntrega: TipoEntrega;
  status: StatusPedido;
  valorTotalCentavos: number;
  tempoPreparoMinutos: number | null;
  createdAt: string;
  updatedAt: string;
  itens: ItemPedidoDTO[];
}

export interface AtualizarStatusPedidoDTO {
  status: StatusPedido;
}

export interface ItemPedidoPublicoDTO {
  produtoId: string;
  quantidade: number;
  observacao?: string;
}

export interface CriarPedidoPublicoDTO {
  clienteNome: string;
  tipoEntrega: 'DELIVERY' | 'RETIRADA';
  itens: ItemPedidoPublicoDTO[];
  chaveIdempotencia?: string;
}

export interface PedidoCriadoDTO {
  id: string;
  numero: number;
  clienteNome: string;
  status: StatusPedido;
  valorTotalCentavos: number;
  createdAt: string;
}

export interface ItemPedidoStatusPublicoDTO {
  produtoNome: string;
  quantidade: number;
  precoUnitarioCentavos: number;
}

export interface PedidoStatusPublicoDTO {
  id: string;
  numero: number;
  clienteNome: string;
  status: StatusPedido;
  tipoEntrega: TipoEntrega;
  valorTotalCentavos: number;
  createdAt: string;
  updatedAt: string;
  itens: ItemPedidoStatusPublicoDTO[];
  pagamento: PagamentoResumoDTO | null;
}

export interface RegistrarDTO {
  nomeRestaurante: string;
  nomeDono: string;
  email: string;
  senha: string;
}

export interface CategoriaDTO {
  id: string;
  nome: string;
  slug: string;
  ordem: number;
  ativa: boolean;
  produtosCount?: number;
  createdAt: string;
}

export interface ProdutoDTO {
  id: string;
  categoriaId: string | null;
  categoria: CategoriaDTO | null;
  nome: string;
  descricao: string | null;
  precoCentavos: number;
  imagemUrl: string | null;
  disponivel: boolean;
  destaque: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCategoriaDTO {
  nome: string;
  ordem?: number;
}

export interface UpdateCategoriaDTO {
  nome?: string;
  ordem?: number;
  ativa?: boolean;
}

export interface ExcluirCategoriaDTO {
  moverProdutosParaCategoriaId?: string;
  desvincularProdutos?: boolean;
}

export interface ReordenarCategoriaDTO {
  direcao: 'CIMA' | 'BAIXO';
}

export interface CreateProdutoDTO {
  nome: string;
  descricao?: string;
  precoCentavos: number;
  categoriaId?: string;
  imagemUrl?: string;
  disponivel?: boolean;
  destaque?: boolean;
}

export type UpdateProdutoDTO = Partial<Omit<CreateProdutoDTO, 'categoriaId'>> & {
  categoriaId?: string | null;
};

export interface UploadImagemResponseDTO {
  url: string;
}
