import 'dotenv/config';
import bcrypt from 'bcrypt';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  PrismaClient,
  CanalVenda,
  TipoEntrega,
  StatusPedido,
} from '../generated/prisma/client';
import { slugify } from '../src/common/slugify.util';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const CLIENTES = [
  'Marina S.',
  'Carlos M.',
  'Beatriz L.',
  'André P.',
  'Fernanda R.',
  'Rodrigo A.',
  'Juliana C.',
  'Lucas T.',
  'Patrícia N.',
  'Bruno F.',
  'Camila D.',
  'Diego V.',
  'Larissa O.',
  'Thiago B.',
  'Vanessa G.',
];

function randomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function randomTimeOnDay(day: Date): Date {
  const d = new Date(day);
  d.setHours(11 + Math.floor(Math.random() * 12), Math.floor(Math.random() * 60), 0, 0);
  return d;
}

type ProdutoSeed = { nome: string; descricao: string; precoCentavos: number };

const CATEGORIAS: { nome: string; produtos: ProdutoSeed[] }[] = [
  {
    nome: 'Carnes',
    produtos: [
      { nome: 'Picanha na Brasa', descricao: 'Picanha grelhada no ponto, servida em tiras', precoCentavos: 5890 },
      { nome: 'Costela Bovina', descricao: 'Costela assada lentamente por 8 horas', precoCentavos: 4990 },
      { nome: 'Fraldinha Grelhada', descricao: 'Fraldinha grelhada com sal grosso', precoCentavos: 4490 },
      { nome: 'Linguiça Artesanal', descricao: 'Linguiça de produção própria', precoCentavos: 3290 },
    ],
  },
  {
    nome: 'Acompanhamentos',
    produtos: [
      { nome: 'Arroz Carreteiro', descricao: 'Arroz com carne seca desfiada', precoCentavos: 1890 },
      { nome: 'Farofa Especial', descricao: 'Farofa com bacon e ovos', precoCentavos: 1490 },
      { nome: 'Vinagrete', descricao: 'Vinagrete tradicional', precoCentavos: 990 },
      { nome: 'Batata Rústica', descricao: 'Batatas assadas com ervas', precoCentavos: 2290 },
    ],
  },
  {
    nome: 'Bebidas',
    produtos: [
      { nome: 'Refrigerante Lata', descricao: '350ml, diversos sabores', precoCentavos: 790 },
      { nome: 'Suco Natural', descricao: '500ml, sabores da estação', precoCentavos: 1190 },
      { nome: 'Água Mineral', descricao: '500ml, com ou sem gás', precoCentavos: 590 },
      { nome: 'Cerveja Long Neck', descricao: '355ml', precoCentavos: 1290 },
    ],
  },
];

async function limparDadosTransacionais(restauranteId: string) {
  await prisma.itemPedido.deleteMany({ where: { pedido: { restauranteId } } });
  await prisma.pedido.deleteMany({ where: { restauranteId } });
  await prisma.produto.deleteMany({ where: { restauranteId } });
  await prisma.categoria.deleteMany({ where: { restauranteId } });
}

async function criarCardapio(restauranteId: string) {
  const produtosCriados: { id: string; precoCentavos: number }[] = [];

  for (let i = 0; i < CATEGORIAS.length; i++) {
    const categoria = await prisma.categoria.create({
      data: {
        restauranteId,
        nome: CATEGORIAS[i].nome,
        slug: slugify(CATEGORIAS[i].nome),
        ordem: i,
      },
    });

    for (const produto of CATEGORIAS[i].produtos) {
      const criado = await prisma.produto.create({
        data: {
          restauranteId,
          categoriaId: categoria.id,
          nome: produto.nome,
          descricao: produto.descricao,
          precoCentavos: produto.precoCentavos,
          disponivel: true,
        },
      });
      produtosCriados.push({ id: criado.id, precoCentavos: criado.precoCentavos });
    }
  }

  return produtosCriados;
}

/**
 * Gera `quantidade` pedidos em `dia`, com canais na proporção informada,
 * ajustando o último pedido de cada canal para o total bater com `totalCentavosAlvo`.
 */
async function gerarPedidosDoDia(params: {
  restauranteId: string;
  dia: Date;
  quantidade: number;
  totalCentavosAlvo: number;
  proporcaoCanais: Record<CanalVenda, number>;
  produtos: { id: string; precoCentavos: number }[];
  numeroInicial: number;
  ehHoje: boolean;
}): Promise<number> {
  const {
    restauranteId,
    dia,
    quantidade,
    totalCentavosAlvo,
    proporcaoCanais,
    produtos,
    numeroInicial,
    ehHoje,
  } = params;

  const canaisDistribuidos: CanalVenda[] = [];
  for (const [canal, proporcao] of Object.entries(proporcaoCanais) as [CanalVenda, number][]) {
    const n = Math.round(quantidade * proporcao);
    for (let i = 0; i < n; i++) canaisDistribuidos.push(canal);
  }
  while (canaisDistribuidos.length < quantidade) canaisDistribuidos.push(CanalVenda.CARDAPIO_DIGITAL);
  canaisDistribuidos.length = quantidade;

  const valorMedio = Math.round(totalCentavosAlvo / quantidade);
  let acumulado = 0;
  let numero = numeroInicial;

  for (let i = 0; i < quantidade; i++) {
    const ultimoPedido = i === quantidade - 1;
    const canal = canaisDistribuidos[i];

    const valorPedido = ultimoPedido
      ? Math.max(1500, totalCentavosAlvo - acumulado)
      : Math.round(valorMedio * (0.7 + Math.random() * 0.6));
    acumulado += valorPedido;

    const tipoEntrega =
      canal === CanalVenda.QR_CODE_SALAO
        ? TipoEntrega.SALAO
        : Math.random() < 0.75
          ? TipoEntrega.DELIVERY
          : TipoEntrega.RETIRADA;

    let status: StatusPedido;
    if (ehHoje && i >= quantidade - 4) {
      status = StatusPedido.NOVO;
    } else if (ehHoje && i >= quantidade - 8) {
      status = randomItem([StatusPedido.CONFIRMADO, StatusPedido.EM_PREPARO, StatusPedido.PRONTO]);
    } else {
      status = StatusPedido.ENTREGUE;
    }

    const tempoPreparoMinutos =
      status === StatusPedido.NOVO ? null : 15 + Math.floor(Math.random() * 20);

    const emAndamento = status !== StatusPedido.ENTREGUE;
    const createdAt =
      ehHoje && emAndamento
        ? new Date(Date.now() - Math.floor(Math.random() * 90) * 60_000)
        : randomTimeOnDay(dia);

    const pedido = await prisma.pedido.create({
      data: {
        restauranteId,
        numero,
        clienteNome: randomItem(CLIENTES),
        canal,
        tipoEntrega,
        status,
        valorTotalCentavos: valorPedido,
        tempoPreparoMinutos,
        createdAt,
      },
    });

    // distribui o valor do pedido em 1-4 itens de produtos reais
    let restante = valorPedido;
    const nItens = 1 + Math.floor(Math.random() * 3);
    for (let j = 0; j < nItens; j++) {
      const ultimoItem = j === nItens - 1;
      const produto = randomItem(produtos);
      const quantidadeItem = 1 + Math.floor(Math.random() * 2);
      const precoUnitario = ultimoItem
        ? Math.max(500, Math.round(restante / quantidadeItem))
        : produto.precoCentavos;
      const totalItem = precoUnitario * quantidadeItem;
      restante -= totalItem;

      await prisma.itemPedido.create({
        data: {
          pedidoId: pedido.id,
          produtoId: produto.id,
          quantidade: quantidadeItem,
          precoUnitarioCentavos: precoUnitario,
        },
      });
    }

    numero++;
  }

  return numero;
}

async function main() {
  if (process.env.NODE_ENV === 'production') {
    console.error(
      'Seed recusado: NODE_ENV=production. Este script cria/atualiza uma ' +
        'conta de demonstração com senha fraca e conhecida (123456) — nunca ' +
        'deve rodar contra um banco de produção.',
    );
    process.exit(1);
  }

  const senhaHash = await bcrypt.hash('123456', 10);

  const restaurante = await prisma.restaurante.upsert({
    where: { slug: 'brasa-e-ponto' },
    update: {},
    create: {
      nome: 'Brasa & Ponto',
      slug: 'brasa-e-ponto',
      plano: 'PRO',
      aberto: true,
      // CPF fictício (válido só no dígito verificador) — sem documento o
      // ContaLiberadaGuard trava o painel no onboarding.
      documento: '52998224725',
    },
  });

  await prisma.usuario.upsert({
    where: { email: 'vitor@brasaeponto.com' },
    update: {},
    create: {
      nome: 'Vitor',
      email: 'vitor@brasaeponto.com',
      senhaHash,
      cargo: 'DONO',
      restauranteId: restaurante.id,
      emailVerificadoEm: new Date(),
    },
  });

  await limparDadosTransacionais(restaurante.id);
  const produtos = await criarCardapio(restaurante.id);

  const hoje = startOfDay(new Date());
  const ontem = addDays(hoje, -1);

  // últimos 7 dias (inclui hoje), totais aproximados em reais
  const totaisPeriodo = [
    1985.4, // hoje - 6
    2210.75, // hoje - 5
    1870.9, // hoje - 4
    2540.15, // hoje - 3
    2860.5, // hoje - 2
    2404.0, // ontem (hoje - 1)
    2847.6, // hoje
  ];

  let numeroPedido = 4700;

  for (let i = 0; i < totaisPeriodo.length; i++) {
    const diasAtras = totaisPeriodo.length - 1 - i;
    const dia = addDays(hoje, -diasAtras);
    const totalCentavos = Math.round(totaisPeriodo[i] * 100);
    const ehHoje = diasAtras === 0;
    const ehOntem = diasAtras === 1;

    const quantidade = ehHoje ? 67 : ehOntem ? 55 : 45 + Math.floor(Math.random() * 15);

    numeroPedido = await gerarPedidosDoDia({
      restauranteId: restaurante.id,
      dia,
      quantidade,
      totalCentavosAlvo: totalCentavos,
      proporcaoCanais: {
        [CanalVenda.CARDAPIO_DIGITAL]: 0.57,
        [CanalVenda.WHATSAPP]: 0.28,
        [CanalVenda.QR_CODE_SALAO]: 0.15,
      } as Record<CanalVenda, number>,
      produtos,
      numeroInicial: numeroPedido,
      ehHoje,
    });
  }

  console.log('Seed concluído:', {
    restaurante: restaurante.nome,
    produtos: produtos.length,
    pedidos: numeroPedido - 4700,
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
