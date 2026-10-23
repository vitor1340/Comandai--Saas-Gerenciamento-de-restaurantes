import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Profile, Strategy, VerifyCallback } from 'passport-google-oauth20';
import { exigirVariavelAmbiente } from '../common/env.util';
import { GoogleOAuthStateStore } from './google-oauth-state.store';
import { UsuarioGoogle } from './google.types';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor() {
    super({
      clientID: exigirVariavelAmbiente('GOOGLE_CLIENT_ID'),
      clientSecret: exigirVariavelAmbiente('GOOGLE_CLIENT_SECRET'),
      callbackURL: exigirVariavelAmbiente('GOOGLE_CALLBACK_URL'),
      scope: ['email', 'profile'],
      store: new GoogleOAuthStateStore(),
    });
  }

  validate(
    _accessToken: string,
    _refreshToken: string,
    profile: Profile,
    done: VerifyCallback,
  ): void {
    const email = profile.emails?.[0]?.value?.trim().toLowerCase();
    if (!email) {
      done(
        new UnauthorizedException('Conta do Google sem e-mail disponível'),
        false,
      );
      return;
    }

    // O login com Google confia no e-mail pra vincular/criar conta (e marca
    // o e-mail como verificado) — só vale se o próprio Google o verificou.
    const emailVerificado = (profile._json as { email_verified?: boolean })
      .email_verified;
    if (emailVerificado !== true) {
      done(
        new UnauthorizedException(
          'O e-mail desta conta do Google não está verificado',
        ),
        false,
      );
      return;
    }

    const usuarioGoogle: UsuarioGoogle = {
      googleId: profile.id,
      email,
      nome: profile.displayName || email,
    };

    done(null, usuarioGoogle);
  }
}
