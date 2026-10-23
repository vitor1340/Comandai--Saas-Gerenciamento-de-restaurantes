import {
  documentoValido,
  mascararDocumento,
  normalizarDocumento,
} from './documento.util';

describe('documento.util', () => {
  it.each(['529.982.247-25', '52998224725', '11.222.333/0001-81'])(
    'aceita documento válido %s',
    (doc) => {
      expect(documentoValido(doc)).toBe(true);
    },
  );

  it.each([
    '529.982.247-24', // dígito errado
    '111.111.111-11', // sequência repetida
    '00000000000000',
    '11.222.333/0001-80',
    '1234567890', // tamanho errado
    '',
  ])('rejeita documento inválido %s', (doc) => {
    expect(documentoValido(doc)).toBe(false);
  });

  it('normaliza removendo máscara', () => {
    expect(normalizarDocumento('11.222.333/0001-81')).toBe('11222333000181');
  });

  it('mascara CPF e CNPJ', () => {
    expect(mascararDocumento('52998224725')).toBe('***.982.***-25');
    expect(mascararDocumento('11222333000181')).toBe('**.222.***/****-81');
  });
});
