import 'dotenv/config';
import { randomUUID } from 'crypto';
import type { AddressInfo } from 'net';
import type { Server as HttpServer } from 'http';
import { io, Socket } from 'socket.io-client';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from './../src/app.module';
import { AuthService } from './../src/auth/auth.service';
import { PedidosService } from './../src/pedidos/pedidos.service';
import { PrismaService } from './../src/prisma/prisma.service';
import { assertTokensCompletos } from './helpers/assert-tokens-completos';
import { gerarCpfValido, marcarEmailVerificado } from './helpers/cadastro';

/**
 * Único spec que precisa de um servidor HTTP escutando de verdade
 * (`app.listen`) — socket.io não funciona só com `app.getHttpServer()` +
 * supertest como o resto dos specs.
 */
describe('Pedidos em tempo real via WebSocket (e2e)', () => {
  let app: INestApplication;
  let authService: AuthService;
  let pedidosService: PedidosService;
  let jwtService: JwtService;
  let prisma: PrismaService;
  let urlServidor: string;

  const execucao = randomUUID().slice(0, 8);
  const restaurantesCriados: string[] = [];
  const usuariosCriados: string[] = [];
  const socketsAbertos: Socket[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    await app.listen(0);

    const httpServer = app.getHttpServer() as HttpServer;
    const endereco = httpServer.address() as AddressInfo;
    urlServidor = `http://127.0.0.1:${endereco.port}`;

    authService = app.get(AuthService);
    pedidosService = app.get(PedidosService);
    jwtService = app.get(JwtService);
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    for (const socket of socketsAbertos) {
      socket.disconnect();
    }
    // Dá tempo do transporte (websocket/polling) encerrar do lado do
    // servidor antes de fechar o app — sem isso, `httpServer.close()` fica
    // esperando indefinidamente conexões mantidas vivas pelo socket.io.
    await new Promise((resolve) => setTimeout(resolve, 200));

    await prisma.itemPedido.deleteMany({
      where: { pedido: { restauranteId: { in: restaurantesCriados } } },
    });
    await prisma.pedido.deleteMany({
      where: { restauranteId: { in: restaurantesCriados } },
    });
    await prisma.produto.deleteMany({
      where: { restauranteId: { in: restaurantesCriados } },
    });
    await prisma.categoria.deleteMany({
      where: { restauranteId: { in: restaurantesCriados } },
    });
    await prisma.usuario.deleteMany({ where: { id: { in: usuariosCriados } } });
    await prisma.restaurante.deleteMany({
      where: { id: { in: restaurantesCriados } },
    });

    (app.getHttpServer() as HttpServer).closeAllConnections();
    await app.close();
  });

  async function criarUsuarioComProduto(sufixo: string) {
    const email = `realtime-${sufixo}-${execucao}@teste.comandai.dev`;
    const resultado = await authService.registrar({
      nomeRestaurante: `Loja Realtime ${sufixo} ${execucao}`,
      nomeDono: `Dono ${sufixo}`,
      email,
      senha: 'senha-123456',
      documento: gerarCpfValido(),
    });
    await marcarEmailVerificado(prisma, email);
    assertTokensCompletos(resultado);
    usuariosCriados.push(resultado.usuario.id);

    const usuario = await prisma.usuario.findUniqueOrThrow({
      where: { id: resultado.usuario.id },
    });
    restaurantesCriados.push(usuario.restauranteId);

    const categoria = await prisma.categoria.create({
      data: {
        restauranteId: usuario.restauranteId,
        nome: 'Categoria Teste',
        slug: `categoria-teste-${usuario.restauranteId}`,
      },
    });
    const produto = await prisma.produto.create({
      data: {
        restauranteId: usuario.restauranteId,
        categoriaId: categoria.id,
        nome: 'Produto Teste',
        precoCentavos: 1500,
      },
    });

    return {
      usuario,
      accessToken: resultado.accessToken,
      produtoId: produto.id,
    };
  }

  function conectar(token: string): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const socket = io(urlServidor, {
        auth: { token },
        forceNew: true,
        reconnection: false,
      });
      socketsAbertos.push(socket);
      socket.once('connect', () => resolve(socket));
      socket.once('connect_error', reject);
    });
  }

  function conectarEAguardarDesfecho(
    token: string,
  ): Promise<'conectado' | 'desconectado'> {
    return new Promise((resolve) => {
      const socket = io(urlServidor, {
        auth: { token },
        forceNew: true,
        reconnection: false,
      });
      socketsAbertos.push(socket);
      let resolvido = false;

      socket.once('disconnect', () => {
        if (!resolvido) {
          resolvido = true;
          resolve('desconectado');
        }
      });
      socket.once('connect_error', () => {
        if (!resolvido) {
          resolvido = true;
          resolve('desconectado');
        }
      });

      setTimeout(() => {
        if (!resolvido) {
          resolvido = true;
          resolve('conectado');
        }
      }, 600);
    });
  }

  it('cliente autenticado recebe pedido.criado do próprio restaurante', async () => {
    const { usuario, accessToken, produtoId } =
      await criarUsuarioComProduto('criado');
    const socket = await conectar(accessToken);

    const eventoPromise = new Promise<Record<string, unknown>>((resolve) => {
      socket.once('pedido.criado', resolve);
    });

    await pedidosService.criarPublico(usuario.restauranteId, {
      clienteNome: 'Cliente Realtime',
      tipoEntrega: 'RETIRADA',
      itens: [{ produtoId, quantidade: 2 }],
    });

    const evento = await eventoPromise;
    expect(evento.clienteNome).toBe('Cliente Realtime');
    expect(evento.status).toBe('NOVO');
  });

  it('atualizarStatus emite pedido.status_atualizado', async () => {
    const { usuario, accessToken, produtoId } =
      await criarUsuarioComProduto('status');
    const socket = await conectar(accessToken);

    const pedido = await pedidosService.criarPublico(usuario.restauranteId, {
      clienteNome: 'Cliente Status',
      tipoEntrega: 'RETIRADA',
      itens: [{ produtoId, quantidade: 1 }],
    });

    const eventoPromise = new Promise<Record<string, unknown>>((resolve) => {
      socket.once('pedido.status_atualizado', resolve);
    });

    await pedidosService.atualizarStatus(
      usuario.restauranteId,
      pedido.id,
      'CONFIRMADO',
    );

    const evento = await eventoPromise;
    expect(evento).toEqual({ id: pedido.id, status: 'CONFIRMADO' });
  });

  it('isolamento multi-tenant: restaurante A não recebe evento de pedido do restaurante B', async () => {
    const tenantA = await criarUsuarioComProduto('tenanta');
    const tenantB = await criarUsuarioComProduto('tenantb');

    const socketA = await conectar(tenantA.accessToken);

    let recebeuNoA = false;
    socketA.once('pedido.criado', () => {
      recebeuNoA = true;
    });

    await pedidosService.criarPublico(tenantB.usuario.restauranteId, {
      clienteNome: 'Cliente do Outro Restaurante',
      tipoEntrega: 'RETIRADA',
      itens: [{ produtoId: tenantB.produtoId, quantidade: 1 }],
    });

    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(recebeuNoA).toBe(false);
  });

  it('conexão sem token é recusada', async () => {
    const desfecho = await conectarEAguardarDesfecho('');
    expect(desfecho).toBe('desconectado');
  });

  it('conexão com token inválido é recusada', async () => {
    const desfecho = await conectarEAguardarDesfecho('token-invalido-qualquer');
    expect(desfecho).toBe('desconectado');
  });

  it('conexão com token de sessão parcial (2FA) é recusada', async () => {
    const tokenParcial = await jwtService.signAsync(
      { sub: 'usuario-fake', tipo: 'PARCIAL_2FA' },
      { expiresIn: '5m' },
    );
    const desfecho = await conectarEAguardarDesfecho(tokenParcial);
    expect(desfecho).toBe('desconectado');
  });
});
