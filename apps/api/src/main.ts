import 'dotenv/config';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // Atrás do proxy do Railway: sem isso req.ip é o IP do proxy e o rate
  // limit por IP vira um limite global. 1 = confia só no salto imediato.
  app.set('trust proxy', 1);
  // API pura em JSON (não serve HTML) — CSP padrão do helmet é inofensiva
  // aqui, mas nosniff/frame-ancestors/HSTS continuam valendo como defesa
  // em profundidade.
  app.use(helmet());
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.enableCors({
    origin: process.env.CORS_ORIGIN ?? 'http://localhost:3000',
    credentials: true,
  });
  await app.listen(process.env.PORT ?? 3001);
}
void bootstrap();
