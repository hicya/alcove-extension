import type { AuthTokens, TokenStorage, PkceStorage } from "./types";

export class MemoryTokenStorage implements TokenStorage {
  private tokens: AuthTokens | null = null;

  getTokens(): AuthTokens | null {
    return this.tokens;
  }

  setTokens(tokens: AuthTokens): void {
    this.tokens = tokens;
  }

  clearTokens(): void {
    this.tokens = null;
  }
}

export class BrowserTokenStorage implements TokenStorage {
  private readonly prefix: string;
  private migrated = false;

  constructor(prefix: string) {
    this.prefix = prefix;
  }

  /**
   * Migrate tokens from legacy localStorage to sessionStorage.
   * Runs once per instance. After migration, the next refresh() call
   * sends the old refresh token in the body (no cookie yet), and the
   * server sets the httpOnly cookie. The refresh token is never stored
   * in sessionStorage — only accessToken and expiresIn.
   */
  private migrateFromLocalStorage(): void {
    if (this.migrated) return;
    this.migrated = true;

    try {
      const legacyAccessToken = localStorage.getItem(`${this.prefix}:access_token`);
      const legacyRefreshToken = localStorage.getItem(`${this.prefix}:refresh_token`);
      const legacyExpiresIn = localStorage.getItem(`${this.prefix}:expires_in`);

      if (legacyAccessToken && legacyExpiresIn) {
        // Copy access token + expiry to sessionStorage (if not already there)
        if (!sessionStorage.getItem(`${this.prefix}:access_token`)) {
          sessionStorage.setItem(`${this.prefix}:access_token`, legacyAccessToken);
          sessionStorage.setItem(`${this.prefix}:expires_in`, legacyExpiresIn);
        }

        // Temporarily store refresh token for the first refresh() call
        // This will be sent in the request body. After that refresh succeeds,
        // the server sets the httpOnly cookie and we clear this.
        if (legacyRefreshToken) {
          sessionStorage.setItem(`${this.prefix}:refresh_token_migration`, legacyRefreshToken);
        }
      }

      // Clear all legacy localStorage entries
      localStorage.removeItem(`${this.prefix}:access_token`);
      localStorage.removeItem(`${this.prefix}:refresh_token`);
      localStorage.removeItem(`${this.prefix}:expires_in`);
    } catch {
      // localStorage/sessionStorage may be unavailable (private browsing, etc.)
    }
  }

  isSignedOut(): boolean {
    try {
      return sessionStorage.getItem(`${this.prefix}:signed_out`) === "1";
    } catch {
      return false;
    }
  }

  getTokens(): AuthTokens | null {
    if (this.isSignedOut()) return null;
    this.migrateFromLocalStorage();

    try {
      const accessToken = sessionStorage.getItem(`${this.prefix}:access_token`);
      const expiresIn = sessionStorage.getItem(`${this.prefix}:expires_in`);

      if (!accessToken || !expiresIn) {
        return null;
      }

      // Check for migration refresh token (one-time use)
      const migrationRefreshToken = sessionStorage.getItem(
        `${this.prefix}:refresh_token_migration`,
      );

      return {
        accessToken,
        expiresIn: Number(expiresIn),
        ...(migrationRefreshToken ? { refreshToken: migrationRefreshToken } : {}),
      };
    } catch {
      return null;
    }
  }

  setTokens(tokens: AuthTokens): void {
    try {
      sessionStorage.setItem(`${this.prefix}:access_token`, tokens.accessToken);
      sessionStorage.setItem(`${this.prefix}:expires_in`, String(tokens.expiresIn));

      // Clear migration refresh token after first successful token set
      // (means the server has set the httpOnly cookie)
      sessionStorage.removeItem(`${this.prefix}:refresh_token_migration`);
      sessionStorage.removeItem(`${this.prefix}:signed_out`);
    } catch {
      // sessionStorage unavailable
    }
  }

  clearTokens(): void {
    try {
      // Keep local sign-out across reload even if remote cookie revocation is interrupted.
      sessionStorage.setItem(`${this.prefix}:signed_out`, "1");
      sessionStorage.removeItem(`${this.prefix}:access_token`);
      sessionStorage.removeItem(`${this.prefix}:expires_in`);
      sessionStorage.removeItem(`${this.prefix}:refresh_token_migration`);
    } catch {
      // sessionStorage unavailable
    }
  }
}

export class SessionPkceStorage implements PkceStorage {
  private readonly key: string;

  constructor(prefix: string) {
    this.key = `${prefix}:pkce_verifier`;
  }

  set(verifier: string): void {
    sessionStorage.setItem(this.key, verifier);
  }

  get(): string | null {
    return sessionStorage.getItem(this.key);
  }

  clear(): void {
    sessionStorage.removeItem(this.key);
  }
}

export class MemoryPkceStorage implements PkceStorage {
  private verifier: string | null = null;

  set(verifier: string): void {
    this.verifier = verifier;
  }

  get(): string | null {
    return this.verifier;
  }

  clear(): void {
    this.verifier = null;
  }
}
