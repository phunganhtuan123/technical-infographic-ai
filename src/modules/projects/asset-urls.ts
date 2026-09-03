"use client";

// Where an uploaded image lives, and why the document does not simply hold its
// URL.
//
// An <img> cannot send an Authorization header, so the permission to fetch an
// asset travels inside the URL as a signature — and that signature expires
// within the hour. Writing such a URL into the diagram would mean a document
// that renders blank an hour later, and an exported file that is already broken
// by the time somebody opens it. Worse for PNG: an SVG pointing at another
// origin taints the canvas, and toBlob then throws instead of saving.
//
// So the document stores a stable name, "asset:<id>". The signed URL is
// resolved fresh at render time, and the bytes are inlined as data at export
// time, which is what makes an exported file stand on its own.

import type { DiagramDocument, DiagramNode } from "@/modules/diagram/schema";
import { absoluteAssetUrl, listAssets, type UploadedAsset } from "@/modules/projects/api-client";

const prefix = "asset:";

export const assetReference = (id: string) => `${prefix}${id}`;

export function assetIdOf(reference: string | undefined | null): string | null {
  return reference && reference.startsWith(prefix) ? reference.slice(prefix.length) : null;
}

// id → a signed URL that works right now.
const signed = new Map<string, string>();
// id → the same bytes as a data: URI, so one export does not fetch twice.
const inlined = new Map<string, string>();

const listeners = new Set<() => void>();
let revision = 0;

function announce() {
  revision += 1;
  for (const listener of listeners) listener();
}

export function subscribeAssets(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function assetsRevision() {
  return revision;
}

/** Nothing is resolved during server rendering, and claiming otherwise hydrates wrong. */
export function serverAssetsRevision() {
  return 0;
}

export function rememberAsset(asset: UploadedAsset) {
  signed.set(asset.id, absoluteAssetUrl(asset.url));
  announce();
}

export function forgetAsset(id: string) {
  signed.delete(id);
  inlined.delete(id);
  announce();
}

/**
 * What an <img> or a CSS url() should point at at this moment.
 *
 * A plain URL or a base64 data: URI — anything saved before uploads existed —
 * passes through untouched. An asset reference resolves to undefined until the
 * project's asset list has arrived, which callers render as "no image" rather
 * than as a broken one.
 */
export function resolveAsset(reference: string | undefined): string | undefined {
  const id = assetIdOf(reference);
  if (!id) return reference;
  return signed.get(id);
}

export async function refreshProjectAssets(projectId: string) {
  const assets = await listAssets(projectId);
  for (const asset of assets) signed.set(asset.id, absoluteAssetUrl(asset.url));
  announce();
  return assets;
}

async function toDataUri(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`asset ${response.status}`);
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("could not read the image"));
    reader.readAsDataURL(blob);
  });
}

async function inlineOne(reference: string | undefined): Promise<string | undefined> {
  const id = assetIdOf(reference);
  if (!id) return reference;
  const cached = inlined.get(id);
  if (cached) return cached;
  const url = signed.get(id);
  if (!url) return undefined;
  try {
    const data = await toDataUri(url);
    inlined.set(id, data);
    return data;
  } catch {
    // A missing image should cost the picture, not the export.
    return undefined;
  }
}

/**
 * inlineAssets swaps every asset reference for the bytes themselves. Exports go
 * through this first so the file that lands in somebody's Downloads folder does
 * not depend on a signature that expires, or on them having an account at all.
 */
export async function inlineAssets(document: DiagramDocument): Promise<DiagramDocument> {
  const references = new Set<string>();
  const collect = (nodes: DiagramNode[]) => {
    for (const node of nodes) if (assetIdOf(node.backgroundImage)) references.add(node.backgroundImage!);
  };
  collect(document.nodes);
  for (const scene of document.scenes ?? []) collect(scene.nodes);
  if (references.size === 0) return document;

  const resolved = new Map<string, string>();
  await Promise.all(
    [...references].map(async (reference) => {
      const data = await inlineOne(reference);
      if (data) resolved.set(reference, data);
    }),
  );

  const swap = (nodes: DiagramNode[]) =>
    nodes.map((node) => {
      const data = node.backgroundImage ? resolved.get(node.backgroundImage) : undefined;
      if (data) return { ...node, backgroundImage: data };
      // Unresolvable: drop the reference rather than write "asset:…" into a file
      // where it means nothing.
      return assetIdOf(node.backgroundImage) ? { ...node, backgroundImage: undefined } : node;
    });

  return {
    ...document,
    nodes: swap(document.nodes),
    scenes: document.scenes?.map((scene) => ({ ...scene, nodes: swap(scene.nodes) })),
  };
}

/** Every asset this workspace still points at, so an unused one can be deleted. */
export function referencedAssetIds(document: DiagramDocument): Set<string> {
  const ids = new Set<string>();
  const collect = (nodes: DiagramNode[]) => {
    for (const node of nodes) {
      const id = assetIdOf(node.backgroundImage);
      if (id) ids.add(id);
    }
  };
  collect(document.nodes);
  for (const scene of document.scenes ?? []) collect(scene.nodes);
  return ids;
}
