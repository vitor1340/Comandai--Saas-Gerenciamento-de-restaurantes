import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { exigirVariavelAmbiente } from '../common/env.util';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { EmailService } from './email.service';
import { GoogleStrategy } from './google.strategy';
import { JwtStrategy } from './jwt.strategy';
import { RefreshTokenService } from './refresh-token.service';
import { TurnstileService } from './turnstile.service';
import { TwoFactorService } from './two-factor.service';

@Module({
  imports: [
    PassportModule,
    JwtModule.register({
      secret: exigirVariavelAmbiente('JWT_SECRET'),
      signOptions: {
        expiresIn: (process.env.JWT_EXPIRES_IN ??
          '15m') as `${number}${'s' | 'm' | 'h' | 'd'}`,
      },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    GoogleStrategy,
    EmailService,
    RefreshTokenService,
    TwoFactorService,
    TurnstileService,
  ],
  exports: [JwtModule, RefreshTokenService],
})
export class AuthModule {}
