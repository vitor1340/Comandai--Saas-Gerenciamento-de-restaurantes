import { registerDecorator, ValidationOptions } from 'class-validator';

export function normalizarDocumento(documento: string): string {
  return documento.replace(/\D/g, '');
}

function digitoVerificador(digitos: string, pesos: number[]): number {
  const soma = pesos.reduce(
    (total, peso, i) => total + Number(digitos[i]) * peso,
    0,
  );
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

function cpfValido(cpf: string): boolean {
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) {
    return false;
  }
  const d1 = digitoVerificador(cpf, [10, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = digitoVerificador(cpf, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  return d1 === Number(cpf[9]) && d2 === Number(cpf[10]);
}

function cnpjValido(cnpj: string): boolean {
  if (!/^\d{14}$/.test(cnpj) || /^(\d)\1{13}$/.test(cnpj)) {
    return false;
  }
  const d1 = digitoVerificador(cnpj, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = digitoVerificador(cnpj, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return d1 === Number(cnpj[12]) && d2 === Number(cnpj[13]);
}

/** Aceita com ou sem máscara (pontos, barra, traço). */
export function documentoValido(documento: string): boolean {
  const digitos = normalizarDocumento(documento);
  return digitos.length === 11 ? cpfValido(digitos) : cnpjValido(digitos);
}

/** Só pra exibição no painel admin — nunca expor o documento inteiro. */
export function mascararDocumento(documento: string): string {
  return documento.length === 11
    ? `***.${documento.slice(3, 6)}.***-${documento.slice(9)}`
    : `**.${documento.slice(2, 5)}.***/****-${documento.slice(12)}`;
}

export function IsCpfOuCnpj(opcoes?: ValidationOptions) {
  return (objeto: object, propriedade: string) => {
    registerDecorator({
      name: 'isCpfOuCnpj',
      target: objeto.constructor,
      propertyName: propriedade,
      options: { message: 'CPF ou CNPJ inválido', ...opcoes },
      validator: {
        validate: (valor: unknown) =>
          typeof valor === 'string' && documentoValido(valor),
      },
    });
  };
}
