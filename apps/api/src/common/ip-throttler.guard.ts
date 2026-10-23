import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import { obterIpCliente } from './client-ip.util';

@Injectable()
export class IpThrottlerGuard extends ThrottlerGuard {
  protected getTracker(req: Record<string, unknown>): Promise<string> {
    return Promise.resolve(obterIpCliente(req as unknown as Request));
  }
}
