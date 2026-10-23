import 'dotenv/config';
import { randomUUID } from 'crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { createClient } from '@supabase/supabase-js';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';
import { gerarCpfValido, marcarEmailVerificado } from './helpers/cadastro';

interface RespostaAuth {
  accessToken: string;
  usuario: { id: string };
}

interface RespostaUpload {
  url: string;
}

// PNG 1x1 válido mínimo (68 bytes)
const PNG_VALIDO = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

function caminhoDoArquivo(url: string, bucket: string): string {
  const marcador = `/object/public/${bucket}/`;
  const indice = url.indexOf(marcador);
  return url.slice(indice + marcador.length);
}

/**
 * Bate em Supabase Storage real (mesma filosofia dos demais e2e, que já batem
 * no Postgres real) — depende de SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY/
 * SUPABASE_STORAGE_BUCKET reais no ambiente. Os arquivos de teste são
 * removidos do bucket no afterAll.
 */
describe('Upload (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? 'comandai';
  const supabase = createClient(
    process.env.SUPABASE_URL ?? '',
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
  );

  const execucao = randomUUID().slice(0, 8);
  let token: string;
  let usuarioId: string;
  let restauranteId: string;
  const caminhosParaLimpar: string[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();

    prisma = app.get(PrismaService);

    const registrar = await request(app.getHttpServer())
      .post('/api/auth/registrar')
      .send({
        nomeRestaurante: `Loja Upload Teste ${execucao}`,
        nomeDono: 'Dono Upload',
        email: `dono-upload-${execucao}@teste.comandai.dev`,
        senha: 'senha-teste-123',
        documento: gerarCpfValido(),
      })
      .expect(201);
    await marcarEmailVerificado(
      prisma,
      `dono-upload-${execucao}@teste.comandai.dev`,
    );
    const corpo = registrar.body as RespostaAuth;
    token = corpo.accessToken;
    usuarioId = corpo.usuario.id;
    const usuario = await prisma.usuario.findUniqueOrThrow({
      where: { id: usuarioId },
    });
    restauranteId = usuario.restauranteId;
  });

  afterAll(async () => {
    if (caminhosParaLimpar.length > 0) {
      await supabase.storage.from(bucket).remove(caminhosParaLimpar);
    }
    await prisma.usuario.deleteMany({ where: { id: usuarioId } });
    await prisma.restaurante.deleteMany({ where: { id: restauranteId } });
    await app.close();
  });

  it('exige autenticação (401)', () => {
    return request(app.getHttpServer())
      .post('/api/upload/produto-imagem')
      .attach('arquivo', PNG_VALIDO, {
        filename: 'teste.png',
        contentType: 'image/png',
      })
      .expect(401);
  });

  it('envia uma imagem válida de produto e retorna a URL pública', async () => {
    const resposta = await request(app.getHttpServer())
      .post('/api/upload/produto-imagem')
      .set('Authorization', `Bearer ${token}`)
      .attach('arquivo', PNG_VALIDO, {
        filename: 'teste.png',
        contentType: 'image/png',
      })
      .expect(201);

    const { url } = resposta.body as RespostaUpload;
    expect(url).toContain(`/produtos/${restauranteId}/`);
    expect(url).toMatch(/\.webp$/);
    caminhosParaLimpar.push(caminhoDoArquivo(url, bucket));
  });

  it('envia uma logo de loja válida e retorna a URL pública', async () => {
    const resposta = await request(app.getHttpServer())
      .post('/api/upload/loja-logo')
      .set('Authorization', `Bearer ${token}`)
      .attach('arquivo', PNG_VALIDO, {
        filename: 'logo.png',
        contentType: 'image/png',
      })
      .expect(201);

    const { url } = resposta.body as RespostaUpload;
    expect(url).toContain(`/lojas/${restauranteId}/`);
    expect(url).toMatch(/\.webp$/);
    caminhosParaLimpar.push(caminhoDoArquivo(url, bucket));
  });

  it('rejeita arquivo que não é imagem (400)', () => {
    return request(app.getHttpServer())
      .post('/api/upload/produto-imagem')
      .set('Authorization', `Bearer ${token}`)
      .attach('arquivo', Buffer.from('isso não é uma imagem'), {
        filename: 'teste.txt',
        contentType: 'text/plain',
      })
      .expect(400);
  });

  it('rejeita "imagem" com mimetype forjado mas conteúdo inválido (400)', () => {
    return request(app.getHttpServer())
      .post('/api/upload/produto-imagem')
      .set('Authorization', `Bearer ${token}`)
      .attach('arquivo', Buffer.from('conteúdo que não é um PNG de verdade'), {
        filename: 'fake.png',
        contentType: 'image/png',
      })
      .expect(400);
  });

  it('rejeita requisição sem nenhum arquivo anexado (400)', () => {
    return request(app.getHttpServer())
      .post('/api/upload/produto-imagem')
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
  });
});
