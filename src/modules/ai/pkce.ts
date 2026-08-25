import type { GatewayMetadata } from "./contracts";

const handshakeKey = "technical-infographic-ai-pkce";
let completionPromise: Promise<string | undefined> | undefined;

function base64Url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function beginPkceAuthorization(metadata: GatewayMetadata) {
  if (!metadata.authorizationEndpoint || !metadata.tokenEndpoint) throw new Error("Gateway OAuth metadata is incomplete");
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(48)));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const state = base64Url(crypto.getRandomValues(new Uint8Array(24)));
  const redirectUri = `${window.location.origin}${window.location.pathname}`;
  sessionStorage.setItem(handshakeKey, JSON.stringify({ verifier, state, redirectUri, tokenEndpoint: metadata.tokenEndpoint, clientId: metadata.clientId }));
  const url = new URL(metadata.authorizationEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", metadata.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", metadata.scopes.join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", base64Url(new Uint8Array(digest)));
  url.searchParams.set("code_challenge_method", "S256");
  window.location.assign(url);
}

async function exchangePkceAuthorization() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  const state = params.get("state");
  const raw = sessionStorage.getItem(handshakeKey);
  if (!code || !state || !raw) return undefined;
  sessionStorage.removeItem(handshakeKey);
  const handshake = JSON.parse(raw) as { verifier: string; state: string; redirectUri: string; tokenEndpoint: string; clientId: string };
  if (state !== handshake.state) throw new Error("AI authorization state mismatch");
  const response = await fetch(handshake.tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: handshake.redirectUri, client_id: handshake.clientId, code_verifier: handshake.verifier }),
  });
  if (!response.ok) throw new Error("AI authorization code exchange failed");
  const body = await response.json() as { access_token?: string };
  if (!body.access_token) throw new Error("AI Gateway did not return an access token");
  params.delete("code"); params.delete("state"); params.delete("session_state");
  window.history.replaceState({}, "", `${window.location.pathname}${params.size ? `?${params}` : ""}${window.location.hash}`);
  return body.access_token;
}

export function completePkceAuthorization() {
  completionPromise ??= exchangePkceAuthorization();
  return completionPromise;
}
