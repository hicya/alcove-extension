import { describe, it, expect } from "vitest";

import { decodeJwtPayload, isTokenExpired, toAuthTokens } from "../auth";

/**
 * The sign-in flow itself (chrome.identity.launchWebAuthFlow) needs a real browser; these
 * tests cover the token parsing and validation around it.
 */

function base64Url(value: string): string {
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function makeJwt(payload: Record<string, unknown>): string {
  const header = base64Url(JSON.stringify({ alg: "ES256", typ: "JWT" }));
  return `${header}.${base64Url(JSON.stringify(payload))}.fake-signature`;
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

describe("decodeJwtPayload", () => {
  it("decodes exp, email and the account id from an unpadded base64url payload", () => {
    const token = makeJwt({ sub: "user-123", email: "reader@example.com", exp: 1700000000 });
    expect(decodeJwtPayload(token)).toEqual({
      exp: 1700000000,
      email: "reader@example.com",
      sub: "user-123",
    });
  });

  it("returns a null email when the claim is missing", () => {
    expect(decodeJwtPayload(makeJwt({ exp: 1 })).email).toBeNull();
  });

  it("throws on an invalid format or payload", () => {
    expect(() => decodeJwtPayload("not-a-jwt")).toThrow("Invalid JWT");
    expect(() => decodeJwtPayload("only.two")).toThrow("Invalid JWT");
    expect(() => decodeJwtPayload(makeJwt({ exp: "soon" }))).toThrow("Invalid JWT payload");
  });
});

describe("isTokenExpired", () => {
  it("detects expired tokens", () => {
    expect(isTokenExpired(makeJwt({ exp: nowSeconds() - 120 }))).toBe(true);
  });

  it("treats tokens expiring within 60s as expired", () => {
    expect(isTokenExpired(makeJwt({ exp: nowSeconds() + 30 }))).toBe(true);
  });

  it("accepts valid tokens", () => {
    expect(isTokenExpired(makeJwt({ exp: nowSeconds() + 3600 }))).toBe(false);
  });

  it("treats malformed tokens as expired", () => {
    expect(isTokenExpired("garbage.data.here")).toBe(true);
  });
});

describe("toAuthTokens", () => {
  it("accepts a token response", () => {
    expect(toAuthTokens({ accessToken: "a", refreshToken: "r", expiresIn: 900 })).toEqual({
      accessToken: "a",
      refreshToken: "r",
      expiresIn: 900,
    });
  });

  it("allows a missing refresh token", () => {
    expect(toAuthTokens({ accessToken: "a", expiresIn: 900 })?.refreshToken).toBeUndefined();
  });

  it("rejects values without an access token", () => {
    expect(toAuthTokens(undefined)).toBeNull();
    expect(toAuthTokens({ error: "invalid_grant" })).toBeNull();
    expect(toAuthTokens({ accessToken: "" })).toBeNull();
    expect(toAuthTokens({ accessToken: 42 })).toBeNull();
  });
});
