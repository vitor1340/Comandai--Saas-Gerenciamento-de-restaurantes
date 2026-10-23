import { Transform } from 'class-transformer';

/** E-mail sempre comparado/salvo em minúsculas e sem espaços nas pontas. */
export const NormalizarEmail = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  );
