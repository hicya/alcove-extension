import { createRemoteJWKSet, jwtVerify } from "jose";

import { AuthSdkError } from "./errors";

import type { AuthTokenPayload } from "./types";

export interface TokenVerifierOptions {
  audience?: string;
  issuer?: string;
}

export function createTokenVerifier(
  authUrl: string,
  options?: TokenVerifierOptions,
): (token: string) => Promise<AuthTokenPayload> {
  const jwks = createRemoteJWKSet(new URL(`${authUrl}/.well-known/jwks.json`));

  return async (token: string): Promise<AuthTokenPayload> => {
    try {
      const { payload } = await jwtVerify(token, jwks, {
        audience: options?.audience,
        issuer: options?.issuer,
      });

      return {
        sub: payload.sub as string,
        email: payload.email as string,
        iss: payload.iss as string,
        aud: payload.aud as string | string[],
        iat: payload.iat as number,
        exp: payload.exp as number,
      };
    } catch {
      throw new AuthSdkError("invalid_token", "Token verification failed");
    }
  };
}
