# Client-connected AI MVP

## Problem

Users need to generate diagrams from prompts or images, comment on individual canvas items, and review changes before they affect a scene. Prompt, image and scoped diagram content must not pass through the Technical Infographic server.

## MVP outcome

A signed-in user connects a client-owned AI Gateway from the browser, generates or modifies an editable diagram, previews the proposal, then accepts or rejects it. Item comments remain local to the browser.

Success criteria:

- No AI request body reaches a Technical Infographic server route.
- Every diagram mutation from AI requires an explicit Accept.
- Selection requests cannot mutate items outside the captured selection.
- A cancelled, rejected, invalid or stale proposal leaves the active scene unchanged.
- Prompt, image and comment drafts survive failed requests in the current browser.

## Required behavior

- Separate application SSO from the `Connect AI` authorization flow.
- Discover client-owned Gateway metadata from its well-known URL without returning secrets.
- Use OAuth/OIDC Authorization Code with PKCE for production Gateways.
- Keep access tokens in memory; use session storage only for the short PKCE redirect handshake.
- Gate text, image, plan, patch and streaming behavior using discovered capabilities.
- Accept prompt input plus one sanitized PNG, JPEG or WebP image by upload, paste or drop.
- Infer New scene or Modify current and expose editable intent, mode and format controls.
- Validate typed proposals and retry one repair request after a validation failure.
- Preview additions in green, modifications in yellow and deletions in red.
- Support Accept all, Reject, Regenerate and Cancel. Partial acceptance is outside MVP.
- Store item and multi-selection comment threads in IndexedDB by workspace and stable item IDs.
- Mark proposals stale when their captured diagram scope changes.

## Out of scope

- Source-code scanning.
- Server-side model calls or provider API keys.
- Cloud synchronization of comments.
- Partial patch acceptance and automatic stale-proposal rebasing.
- Multiple simultaneous proposal variants.
- Arbitrary model-generated JavaScript, CSS, SVG paths or coordinates.

## Release gate

Unit tests cover proposal validation, discovery and context boundaries. Typecheck and production build must pass. Each client-owned Gateway must still be validated separately because its issuer, CORS policy and capability response are controlled by that client.
