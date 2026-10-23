import type { Request } from 'express';
import { obterIpCliente } from './client-ip.util';

function requisicao(headers: Record<string, string>, ip = '10.0.0.1'): Request {
  return { headers, ip } as unknown as Request;
}

describe('obterIpCliente', () => {
  const segredoOriginal = process.env.INTERNAL_PROXY_SECRET;

  beforeEach(() => {
    process.env.INTERNAL_PROXY_SECRET = 'segredo-de-teste';
  });

  afterAll(() => {
    process.env.INTERNAL_PROXY_SECRET = segredoOriginal;
  });

  it('usa o IP repassado pelo Next quando o segredo confere', () => {
    expect(
      obterIpCliente(
        requisicao({
          'x-comandai-client-ip': '200.1.2.3',
          'x-comandai-proxy-secret': 'segredo-de-teste',
        }),
      ),
    ).toBe('200.1.2.3');
  });

  it('ignora o header forjado sem o segredo certo', () => {
    expect(
      obterIpCliente(
        requisicao({
          'x-comandai-client-ip': '200.1.2.3',
          'x-comandai-proxy-secret': 'chute',
        }),
      ),
    ).toBe('10.0.0.1');
    expect(
      obterIpCliente(requisicao({ 'x-comandai-client-ip': '200.1.2.3' })),
    ).toBe('10.0.0.1');
  });

  it('sem INTERNAL_PROXY_SECRET configurado, nunca confia no header', () => {
    delete process.env.INTERNAL_PROXY_SECRET;
    expect(
      obterIpCliente(
        requisicao({
          'x-comandai-client-ip': '200.1.2.3',
          'x-comandai-proxy-secret': '',
        }),
      ),
    ).toBe('10.0.0.1');
  });
});
