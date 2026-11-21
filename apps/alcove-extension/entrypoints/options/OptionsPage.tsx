import { useCallback, useEffect, useState } from "react";
import {
  HICYA_APPS_LABEL,
  HICYA_APPS_URL,
  HICYA_EXPORT_LABEL,
  HICYA_FUNDING_LABEL,
  HICYA_FUNDING_URL,
  HICYA_SIGNATURE_LINE,
  HICYA_WORDMARK,
} from "@hicya/signature";
import { SplotchText } from "@hicya/ui/splotch-text";

import { SAVE_SHORTCUT } from "../../lib/manifest";
import { toActionResponse, toAuthState } from "../../lib/messaging";

import type { AuthStateResponse, BackgroundMessage, SignInProvider } from "../../lib/messaging";

async function send(message: BackgroundMessage): Promise<unknown> {
  const response: unknown = await chrome.runtime.sendMessage(message);
  return response;
}

async function readShortcut(): Promise<string> {
  try {
    const commands = await chrome.commands.getAll();
    const action = commands.find((command) => command.name === "_execute_action");
    return action?.shortcut ?? "";
  } catch {
    return SAVE_SHORTCUT;
  }
}

function formatShortcut(shortcut: string): string {
  return shortcut.replace(/\+/g, " + ");
}

export function OptionsPage() {
  const [authState, setAuthState] = useState<AuthStateResponse | null>(null);
  const [shortcut, setShortcut] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshAuthState = useCallback(async () => {
    try {
      setAuthState(toAuthState(await send({ type: "GET_AUTH_STATE" })));
    } catch {
      setAuthState({ loggedIn: false });
    }
  }, []);

  useEffect(() => {
    void refreshAuthState();
    void readShortcut().then(setShortcut);
  }, [refreshAuthState]);

  async function handleSignIn(provider: SignInProvider) {
    setBusy(true);
    setError(null);
    try {
      const response = toActionResponse(await send({ type: "LOGIN", provider }));
      if (response.error) {
        setError("Sign-in didn't finish. Please try again.");
      } else {
        await refreshAuthState();
      }
    } catch {
      setError("Sign-in didn't finish. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSignOut() {
    setBusy(true);
    try {
      await send({ type: "LOGOUT" });
      setAuthState({ loggedIn: false });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="options-page">
      <header className="options-header">
        <img className="mark" src="/assets/icon-128.png" alt="" width={48} height={48} />
        <div>
          <h1>Alcove</h1>
          <p className="subtitle">Save now, read later, on every device.</p>
        </div>
      </header>

      <section className="card" aria-labelledby="account-heading">
        <h2 id="account-heading">Account</h2>
        <div className="account" aria-busy={authState === null}>
          {authState === null ? (
            <>
              <span className="skeleton skeleton-text" />
              <span className="skeleton skeleton-button" />
            </>
          ) : authState.loggedIn ? (
            <>
              <p className="status">
                Signed in as <strong>{authState.email ?? "your hicya account"}</strong>
              </p>
              <button className="btn btn-secondary" onClick={handleSignOut} disabled={busy}>
                {busy ? "Signing out…" : "Sign out"}
              </button>
              <p className="delete-account">
                <a
                  href="https://alcove.hicya.org/settings#delete-account"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Delete account
                </a>{" "}
                opens Alcove's settings, where you can delete your account and everything synced to
                it. Deleted data is removed from our live systems right away. Encrypted backups may
                hold it for up to 30 days, after which it is gone.
              </p>
            </>
          ) : (
            <>
              <p className="status">
                Sign in with the account you use for Alcove on your phone or the web.
              </p>
              <div className="sign-in-buttons">
                <button
                  className="btn btn-apple"
                  onClick={() => void handleSignIn("apple")}
                  disabled={busy}
                >
                  <svg viewBox="0 0 17 20" aria-hidden="true" className="provider-logo">
                    <path
                      fill="currentColor"
                      d="M14.2 10.6c0-2.6 2.1-3.8 2.2-3.9-1.2-1.8-3.1-2-3.7-2-1.6-.2-3.1.9-3.9.9-.8 0-2.1-.9-3.4-.9-1.7 0-3.3 1-4.2 2.6-1.8 3.1-.5 7.7 1.3 10.2.9 1.2 1.9 2.6 3.2 2.6 1.3-.1 1.8-.8 3.3-.8 1.6 0 2 .8 3.4.8 1.4 0 2.3-1.3 3.1-2.5 1-1.4 1.4-2.8 1.4-2.9 0 0-2.7-1-2.7-4.1zM11.6 3c.7-.9 1.2-2 1-3.2-1 0-2.3.7-3 1.5-.7.8-1.2 2-1.1 3.1 1.2.1 2.3-.6 3.1-1.4z"
                    />
                  </svg>
                  Continue with Apple
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={() => void handleSignIn("google")}
                  disabled={busy}
                >
                  Continue with Google
                </button>
              </div>
            </>
          )}
        </div>
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
      </section>

      <section className="card" aria-labelledby="save-heading">
        <h2 id="save-heading">Ways to save</h2>
        <ul className="ways">
          <li>
            <span className="way-title">Toolbar button</span>
            <span className="way-detail">Click the Alcove button to save the page you are on.</span>
          </li>
          <li>
            <span className="way-title">Keyboard shortcut</span>
            <span className="way-detail">
              {shortcut === null ? (
                <span className="skeleton skeleton-inline" />
              ) : shortcut ? (
                <>
                  Press <kbd>{formatShortcut(shortcut)}</kbd> on any article.
                </>
              ) : (
                "Assign a shortcut in your browser's extension shortcut settings."
              )}
            </span>
          </li>
          <li>
            <span className="way-title">Right-click</span>
            <span className="way-detail">
              Choose <em>Save link to Alcove</em> on any link to save it without opening it.
            </span>
          </li>
        </ul>
      </section>

      <section className="card" aria-labelledby="privacy-heading">
        <h2 id="privacy-heading">Privacy</h2>
        <p>
          Alcove reads a page only when you ask it to save one. Saved articles sync to your Alcove
          account and nowhere else. No ads. On Chrome and Edge, Alcove counts saves and sign-ins
          with Google Analytics, linked to your hicya account when you're signed in, never the pages
          you read.
        </p>
        <nav className="links" aria-label="Alcove links">
          <a href="https://alcove.hicya.org" target="_blank" rel="noopener noreferrer">
            Open Alcove
          </a>
          <a href="https://hicya.org/alcove/privacy" target="_blank" rel="noopener noreferrer">
            Privacy policy
          </a>
          <a href="https://hicya.org/alcove/support" target="_blank" rel="noopener noreferrer">
            Support
          </a>
        </nav>
      </section>

      <footer className="signature" aria-label="About hicya">
        <p className="wordmark">
          <SplotchText>{HICYA_WORDMARK}</SplotchText>
        </p>
        <p className="signature-line">{HICYA_SIGNATURE_LINE}</p>
        <ul className="signature-rows">
          <li>
            <a href="https://alcove.hicya.org/settings" target="_blank" rel="noopener noreferrer">
              <span>{HICYA_EXPORT_LABEL}</span>
              <span className="row-hint">Your saved articles live in your Alcove account</span>
            </a>
          </li>
          <li>
            <a href={HICYA_FUNDING_URL} target="_blank" rel="noopener noreferrer">
              <span>{HICYA_FUNDING_LABEL}</span>
            </a>
          </li>
          <li>
            <a href={HICYA_APPS_URL} target="_blank" rel="noopener noreferrer">
              <span>{HICYA_APPS_LABEL}</span>
            </a>
          </li>
        </ul>
      </footer>
    </main>
  );
}
