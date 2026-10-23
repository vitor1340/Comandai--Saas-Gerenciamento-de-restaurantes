import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma, StatusPedido } from '../../generated/prisma/client';
import { normalizarDocumento } from '../common/documento.util';
import { PrismaService } from '../prisma/prisma.service';
import { CompletarCadastroDto } from './dto/completar-cadastro.dto';
import { UpdateRestauranteDto } from './dto/update-restaurante.dto';
import {
  calcularDiasRestantesTeste,
  calcularStatusPlano,
} from './plan-status.util';

@Injectable()
export class RestaurantesService {
  constructor(private readonly prisma: PrismaService) {}

  async me(restauranteId: string) {
    const restaurante = await this.prisma.restaurante.findUniqueOrThrow({
      where: { id: restauranteId },
    });

    const pedidosNovosCount = await this.prisma.pedido.count({
      where: { restauranteId, status: StatusPedido.NOVO },
    });

    return {
      id: restaurante.id,
      nome: restaurante.nome,
      slug: restaurante.slug,
      plano: restaurante.plano,
      statusPlano: calcularStatusPlano(restaurante),
      trialEndsAt: restaurante.trialEndsAt.toISOString(),
      diasRestantesTeste: calcularDiasRestantesTeste(restaurante.trialEndsAt),
      aberto: restaurante.aberto,
      whatsapp: restaurante.whatsapp,
      tagline: restaurante.tagline,
      logoUrl: restaurante.logoUrl,
      corDestaque: restaurante.corDestaque,
      tipoAtendimento: restaurante.tipoAtendimento,
      endereco: restaurante.endereco,
      horarioFuncionamento: restaurante.horarioFuncionamento,
      diferenciais: restaurante.diferenciais,
      pedidosNovosCount,
      mercadoPagoConectado: Boolean(restaurante.mercadoPagoAccessToken),
      faixaAssinatura: restaurante.faixaAssinatura,
      documentoPendente: restaurante.documento === null,
      suspenso: restaurante.suspensoEm !== null,
    };
  }

  async completarCadastro(restauranteId: string, dto: CompletarCadastroDto) {
    const documento = normalizarDocumento(dto.documento);

    // updateMany com `documento: null` no where: só preenche uma vez — trocar
    // o documento depois abriria brecha pra "liberar" o CPF e reusar em
    // outra conta.
    try {
      const { count } = await this.prisma.restaurante.updateMany({
        where: { id: restauranteId, documento: null },
        data: { documento, nome: dto.nomeRestaurante },
      });
      if (count === 0) {
        throw new ConflictException(
          'O CPF/CNPJ deste restaurante já foi informado.',
        );
      }
    } catch (erro) {
      if (
        erro instanceof Prisma.PrismaClientKnownRequestError &&
        erro.code === 'P2002'
      ) {
        throw new ConflictException(
          'Já existe um restaurante cadastrado com este CPF/CNPJ. Se ele é seu, entre com a conta original.',
        );
      }
      throw erro;
    }

    return this.me(restauranteId);
  }

  async atualizar(restauranteId: string, dto: UpdateRestauranteDto) {
    await this.prisma.restaurante.update({
      where: { id: restauranteId },
      data: {
        ...(dto.nome !== undefined ? { nome: dto.nome } : {}),
        ...(dto.whatsapp !== undefined
          ? { whatsapp: dto.whatsapp || null }
          : {}),
        ...(dto.aberto !== undefined ? { aberto: dto.aberto } : {}),
        ...(dto.tagline !== undefined ? { tagline: dto.tagline || null } : {}),
        ...(dto.logoUrl !== undefined ? { logoUrl: dto.logoUrl || null } : {}),
        ...(dto.corDestaque !== undefined
          ? { corDestaque: dto.corDestaque || null }
          : {}),
        ...(dto.tipoAtendimento !== undefined
          ? { tipoAtendimento: dto.tipoAtendimento }
          : {}),
        ...(dto.endereco !== undefined
          ? { endereco: dto.endereco || null }
          : {}),
        ...(dto.horarioFuncionamento !== undefined
          ? { horarioFuncionamento: dto.horarioFuncionamento || null }
          : {}),
        ...(dto.diferenciais !== undefined
          ? {
              diferenciais: dto.diferenciais.filter(
                (texto) => texto.trim().length > 0,
              ),
            }
          : {}),
      },
    });

    // Reaproveita o select seguro de me() em vez de devolver a linha crua
    // do Prisma — a versão anterior devolvia os tokens do Mercado Pago
    // (criptografados, mas ainda assim não deveriam sair da API).
    return this.me(restauranteId);
  }
}
