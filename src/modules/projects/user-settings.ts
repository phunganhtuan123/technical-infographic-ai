"use client";

// The handful of editor preferences worth carrying between machines.
//
// Today that is one thing: where the AI gateway is. It is a URL somebody typed
// once, and having to type it again on a laptop is exactly the small friction
// that makes a second machine feel like a downgrade.
//
// Only the *origin* travels. The server has no column for a key or a token and
// this file never sends one — that is the arrangement in ADR-001, and the API
// refuses any value that looks like a credential anyway. What is remembered is
// where the gateway is, not how to talk to it.

import { saveClientGatewayUrl, savedClientGatewayUrl } from "@/modules/ai/gateway";
import { fetchSettings, saveSettings, sessionSnapshot } from "@/modules/projects/api-client";

// The mock connector is a development fixture. Syncing it would push a value
// that means nothing on another machine.
const notPortable = new Set(["local-mock", ""]);

/**
 * Bring this browser and the account into agreement, once, at sign-in.
 *
 * A gateway configured here wins: the person set it up on this machine, in
 * front of them, and silently swapping it for a value from another machine
 * would break a connection that was working. Only when this browser has nothing
 * does the stored origin fill the gap.
 */
export async function reconcileSettings(): Promise<void> {
  if (!sessionSnapshot()) return;
  let stored;
  try {
    stored = await fetchSettings();
  } catch {
    // Settings are a convenience. Failing to read them must not stop a sync.
    return;
  }

  const here = savedClientGatewayUrl();
  if (here && !notPortable.has(here)) {
    if (stored.aiGatewayOrigin !== here) await saveSettings({ aiGatewayOrigin: here }).catch(() => undefined);
    return;
  }
  if (stored.aiGatewayOrigin) saveClientGatewayUrl(stored.aiGatewayOrigin);
}

/** Called when the editor connects to a gateway, so the next machine inherits it. */
export async function rememberGatewayOrigin(origin: string): Promise<void> {
  if (!sessionSnapshot() || notPortable.has(origin)) return;
  await saveSettings({ aiGatewayOrigin: origin }).catch(() => undefined);
}
