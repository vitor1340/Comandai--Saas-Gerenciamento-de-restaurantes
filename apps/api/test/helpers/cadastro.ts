import { randomInt } from 'crypto';
import type { PrismaService } from '../../src/prisma/prisma.service';

function digito(base: number[]): number {
  const soma = base.reduce(
    (total, d, i) => total + d * (base.length + 1 - i),
    0,
  );
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

/**
 * CPF aleatório com dígitos verificadores válidos — `documento` é único no
 * banco, então cada cadastro de teste precisa de um diferente.
 */
export function gerarCpfValido(): string {
  const base = Array.from({ length: 9 }, () => randomInt(0, 10));
  base.push(digito(base));
  base.push(digito(base));
  return base.join('');
}

/**
 * O cadastro deixa o e-mail pendente de verificação, e o ContaLiberadaGuard
 * bloqueia escrita até lá. Specs que não testam a verificação em si usam
 * isto logo depois de registrar.
 */
export async function marcarEmailVerificado(
  prisma: PrismaService,
  email: string,
): Promise<void> {
  await prisma.usuario.update({
    where: { email },
    data: { emailVerificadoEm: new Date() },
  });
}
