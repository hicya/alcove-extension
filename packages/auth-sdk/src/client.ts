import { AuthSdkError } from "./errors";
import { generateCodeVerifier, generateCodeChallenge } from "./pkce";
import { defaultSessionHint } from "./session-hint";
import { createTokenVerifier } from "./verify";

import type {
  AuthClient,
  AuthClientConfig,
  AuthTokens,
  AuthUser,
  HandleCallbackOptions,
  IdentityTokenLoginOptions,
  LoginOptions,
  OAuthProvider,
} from "./types";

export function createAuthClient(config: AuthClientConfig): AuthClient {
  const { authUrl, clientId, redirectUri, storage } = config;
  const hint = config.sessionHint === undefined ? defaultSessionHint() : config.sessionHint;
  let verifier: ((token: string) => Promise<import("./types").AuthTokenPayload>) | null = null;
  let revision = 0;
  let readable = true; // An initial empty store may still have a valid httpOnly refresh cookie.
  let operations = Promise.resolve();
  let granting = false;

  const changed = () =>
    new AuthSdkError("session_changed", "This sign-in has ended. Sign in again to continue.");
  const requireCurrent = (expected: number) => {
    if (expected !== revision) throw changed();
  };
  const beginIdentity = () => {
    readable = false;
    return ++revision;
  };
  function serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = operations.then(operation);
    operations = result.then(
      () => {},
      () => {},
    );
    return result;
  }
  function getVerifier() {
    if (!verifier) verifier = createTokenVerifier(authUrl);
    return verifier;
  }
  async function request<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      return await operation(controller.signal);
    } finally {
      clearTimeout(timer);
    }
  }
  function postForm(
    url: string,
    params: Record<string, string>,
    signal: AbortSignal,
    keepalive = false,
  ) {
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      // A string, not URLSearchParams: React Native's fetch sends a URLSearchParams body empty.
      body: new URLSearchParams(params).toString(),
      credentials: "include",
      keepalive,
      signal,
    });
  }
  async function revoke(refreshToken?: string) {
    try {
      await request((signal) =>
        postForm(
          `${authUrl}/token/revoke`,
          refreshToken ? { refresh_token: refreshToken } : {},
          signal,
          true,
        ),
      );
    } catch {
      /* Remote revocation remains best effort; local sign-out is independent. */
    }
  }
  async function grant(
    path: string,
    params: Record<string, string>,
    expected: number,
  ): Promise<AuthTokens> {
    requireCurrent(expected);
    granting = true;
    try {
      const data = await request(async (signal) => {
        const response = await postForm(`${authUrl}${path}`, params, signal);
        if (!response.ok) throw await AuthSdkError.fromResponse(response);
        return (await response.json()) as AuthTokens;
      });
      if (expected === revision) {
        await storage.setTokens(data);
        if (expected === revision) {
          readable = true;
          hint?.set();
          return data;
        }
      }
      // A late successful response can rotate an httpOnly cookie or a mobile refresh token.
      // Clean it up before the next identity operation, including after an async storage write.
      try {
        await storage.clearTokens();
      } finally {
        await revoke(data.refreshToken);
      }
      throw changed();
    } finally {
      granting = false;
    }
  }

  async function currentTokens() {
    const expected = revision;
    if (!readable || (await storage.isSignedOut?.())) return null;
    const tokens = await storage.getTokens();
    return expected === revision && readable ? tokens : null;
  }

  return {
    async login(options: LoginOptions): Promise<string> {
      const expected = beginIdentity();
      return serialize(async () => {
        requireCurrent(expected);
        await storage.clearTokens();
        const codeVerifier = generateCodeVerifier();
        const codeChallenge = await generateCodeChallenge(codeVerifier);
        requireCurrent(expected);
        await options.pkceStorage.set(codeVerifier);
        requireCurrent(expected);
        const params = new URLSearchParams({
          client_id: clientId,
          redirect_uri: redirectUri,
          code_challenge: codeChallenge,
          code_challenge_method: "S256",
        });
        if (options.provider) params.set("provider", options.provider);
        if (options.state) params.set("state", options.state);
        return `${authUrl}/authorize?${params.toString()}`;
      });
    },
    async handleCallback(options: HandleCallbackOptions): Promise<AuthTokens> {
      const expected = beginIdentity();
      return serialize(async () => {
        requireCurrent(expected);
        const codeVerifier = await options.pkceStorage.get();
        if (!codeVerifier)
          throw new AuthSdkError("pkce_missing", "No PKCE code verifier found in storage");
        requireCurrent(expected);
        await storage.clearTokens();
        const tokens = await grant(
          "/token",
          {
            grant_type: "authorization_code",
            code: options.code,
            code_verifier: codeVerifier,
            client_id: clientId,
            redirect_uri: redirectUri,
          },
          expected,
        );
        await options.pkceStorage.clear();
        requireCurrent(expected);
        return tokens;
      });
    },
    async loginWithIdentityToken(
      provider: OAuthProvider,
      identityToken: string,
      options?: IdentityTokenLoginOptions,
    ): Promise<AuthTokens> {
      const expected = beginIdentity();
      return serialize(async () => {
        requireCurrent(expected);
        await storage.clearTokens();
        const params: Record<string, string> = {
          grant_type: "identity_token",
          provider,
          identity_token: identityToken,
          client_id: clientId,
        };
        if (options?.authorizationCode) params.authorization_code = options.authorizationCode;
        return grant("/token", params, expected);
      });
    },
    async loginAsGuest(): Promise<AuthTokens> {
      const expected = beginIdentity();
      return serialize(async () => {
        requireCurrent(expected);
        await storage.clearTokens();
        return grant("/token", { grant_type: "guest", client_id: clientId }, expected);
      });
    },
    async refresh(): Promise<AuthTokens> {
      const expected = revision;
      if (!readable) throw changed();
      return serialize(async () => {
        requireCurrent(expected);
        if (await storage.isSignedOut?.()) throw changed();
        requireCurrent(expected);
        const tokens = await storage.getTokens();
        requireCurrent(expected);
        const params: Record<string, string> = { client_id: clientId };
        if (tokens?.refreshToken) params.refresh_token = tokens.refreshToken;
        // Cookie sessions only: skip the call when this browser has no session hint.
        else if (hint && !hint.shouldRefresh()) {
          throw new AuthSdkError("no_session", "Not signed in in this browser");
        }
        try {
          return await grant("/token/refresh", params, expected);
        } catch (error) {
          // The service refused the refresh (no, expired or revoked cookie): forget the hint.
          if (error instanceof AuthSdkError && error.status === 400) hint?.clear();
          throw error;
        }
      });
    },
    async logout(): Promise<void> {
      beginIdentity();
      hint?.clear();
      // Revoke without waiting for a pending response body; keepalive permits unload cleanup.
      const needsFinalRevoke = granting;
      const clearing = Promise.resolve(storage.getTokens()).then(async (tokens) => {
        await storage.clearTokens();
        await revoke(tokens?.refreshToken);
      });
      // The queued result still propagates this error; keep an early rejection handled meanwhile.
      void clearing.catch(() => {});
      return serialize(async () => {
        await clearing;
        await storage.clearTokens();
        // Older response headers may have installed another cookie after the early revoke.
        if (needsFinalRevoke) await revoke();
      });
    },
    async deleteAccount(): Promise<void> {
      const expected = revision;
      return serialize(async () => {
        requireCurrent(expected);
        const tokens = await storage.getTokens();
        requireCurrent(expected);
        if (!tokens?.accessToken)
          throw new AuthSdkError("token_expired", "No access token available");
        await request(async (signal) => {
          const response = await fetch(`${authUrl}/me`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${tokens.accessToken}` },
            signal,
          });
          if (!response.ok) throw await AuthSdkError.fromResponse(response);
        });
        if (expected === revision) beginIdentity();
        hint?.clear();
        await storage.clearTokens();
      });
    },
    async verifyToken(token: string) {
      return getVerifier()(token);
    },
    async getUser(): Promise<AuthUser> {
      const expected = revision;
      const tokens = await currentTokens();
      requireCurrent(expected);
      if (!tokens?.accessToken)
        throw new AuthSdkError("token_expired", "No access token available");
      const user = await request(async (signal) => {
        const response = await fetch(`${authUrl}/userinfo`, {
          headers: { Authorization: `Bearer ${tokens.accessToken}` },
          signal,
        });
        if (!response.ok) throw await AuthSdkError.fromResponse(response);
        return (await response.json()) as AuthUser;
      });
      requireCurrent(expected);
      return user;
    },
    getTokens: currentTokens,
  };
}
