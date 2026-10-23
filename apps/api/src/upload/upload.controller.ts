import {
  BadRequestException,
  Controller,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/jwt.types';
import { ContaLiberadaGuard } from '../restaurantes/conta-liberada.guard';
import { UploadService } from './upload.service';

const TIPOS_RECUSADOS = ['image/svg+xml'];
const TAMANHO_MAXIMO_BYTES = 10 * 1024 * 1024;

function ehImagemAceita(mimetype: string): boolean {
  return mimetype.startsWith('image/') && !TIPOS_RECUSADOS.includes(mimetype);
}

@UseGuards(JwtAuthGuard, ContaLiberadaGuard)
@Controller('upload')
export class UploadController {
  constructor(private readonly uploadService: UploadService) {}

  @Post('produto-imagem')
  @UseInterceptors(
    FileInterceptor('arquivo', { limits: { fileSize: TAMANHO_MAXIMO_BYTES } }),
  )
  async enviarImagemProduto(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() arquivo?: Express.Multer.File,
  ) {
    if (!arquivo) {
      throw new BadRequestException('Nenhum arquivo enviado');
    }
    if (!ehImagemAceita(arquivo.mimetype)) {
      throw new BadRequestException(
        'Formato de imagem não suportado. Envie uma foto (JPEG, PNG, HEIC, WEBP, GIF etc.), até 10MB.',
      );
    }

    const url = await this.uploadService.enviarImagemProduto(
      arquivo,
      user.restauranteId,
    );
    return { url };
  }

  @Post('loja-logo')
  @UseInterceptors(
    FileInterceptor('arquivo', { limits: { fileSize: TAMANHO_MAXIMO_BYTES } }),
  )
  async enviarImagemLoja(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() arquivo?: Express.Multer.File,
  ) {
    if (!arquivo) {
      throw new BadRequestException('Nenhum arquivo enviado');
    }
    if (!ehImagemAceita(arquivo.mimetype)) {
      throw new BadRequestException(
        'Formato de imagem não suportado. Envie uma foto (JPEG, PNG, HEIC, WEBP, GIF etc.), até 10MB.',
      );
    }

    const url = await this.uploadService.enviarImagemLoja(
      arquivo,
      user.restauranteId,
    );
    return { url };
  }
}
