import type { SessionHint } from "./session-hint";

/** JWT access token claims */
export interface AuthTokenPayload {
  /** Subject — hicya user ID */
  sub: string;
  /** User's email */
  email: string;
  /** Issuer — auth service URL */
  iss: string;
  /** Audience — client ID(s) */
  aud: string | string[];
  /** Issued at (Unix timestamp) */
  iat: number;
  /** Expiration (Unix timestamp) */
  exp: number;
}

/** User profile from the auth service */
export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  createdAt: string;
}

/** Token pair returned from token endpoints */
export interface AuthTokens {
  accessToken: string;
  /** Absent when refresh token is managed via httpOnly cookie */
  refreshToken?: string;
  /** Access token TTL in seconds */
  expiresIn: number;
}

/** JWKS endpoint response */
export interface JwksResponse {
  keys: Record<string, unknown>[];
}

/** Supported OAuth providers */
export type OAuthProvider = "google" | "apple";

/** Error response from the auth service */
export interface AuthError {
  error: string;
  errorDescription?: string;
}

/** Configuration for creating an auth client */
export interface AuthClientConfig {
  /** Auth service URL (e.g., "https://auth.hicya.org") */
  authUrl: string;
  /** Client identifier (e.g., "flashcards") */
  clientId: string;
  /** OAuth callback URL */
  redirectUri: string;
  /** Token persistence strategy */
  storage: TokenStorage;
  /**
   * Whether a cookie-based refresh is worth attempting (see session-hint.ts). Defaults to the
   * `hicya_session` cookie hint in browsers and none elsewhere; pass null to always refresh.
   */
  sessionHint?: SessionHint | null;
}

/** Token persistence interface — consumers provide implementations */
export interface TokenStorage {
  /** Optional persisted local sign-out boundary; interactive grants may still succeed. */
  isSignedOut?(): boolean | Promise<boolean>;
  getTokens(): AuthTokens | null | Promise<AuthTokens | null>;
  setTokens(tokens: AuthTokens): void | Promise<void>;
  clearTokens(): void | Promise<void>;
}

/** PKCE verifier persistence — passed to login/callback calls */
export interface PkceStorage {
  set(verifier: string): void | Promise<void>;
  get(): string | null | Promise<string | null>;
  clear(): void | Promise<void>;
}

/** Options for login() */
export interface LoginOptions {
  provider?: OAuthProvider;
  state?: string;
  pkceStorage: PkceStorage;
}

/** Options for loginWithIdentityToken() */
export interface IdentityTokenLoginOptions {
  /**
   * Provider authorization code from the same native sign-in (Sign in with Apple returns one).
   * Sent as `authorization_code` so the service can obtain and later revoke a provider grant.
   */
  authorizationCode?: string;
}

/** Options for handleCallback() */
export interface HandleCallbackOptions {
  code: string;
  state?: string;
  pkceStorage: PkceStorage;
}

/** Auth client interface */
export interface AuthClient {
  login(options: LoginOptions): Promise<string>;
  handleCallback(options: HandleCallbackOptions): Promise<AuthTokens>;
  loginWithIdentityToken(
    provider: OAuthProvider,
    identityToken: string,
    options?: IdentityTokenLoginOptions,
  ): Promise<AuthTokens>;
  /** Create a device-bound guest account (only for clients the auth service allows). */
  loginAsGuest(): Promise<AuthTokens>;
  refresh(): Promise<AuthTokens>;
  logout(): Promise<void>;
  deleteAccount(): Promise<void>;
  verifyToken(token: string): Promise<AuthTokenPayload>;
  getUser(): Promise<AuthUser>;
  getTokens(): Promise<AuthTokens | null>;
}
