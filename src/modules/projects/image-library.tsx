"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { deleteAsset, listAssets, uploadAsset, type UploadedAsset } from "./api-client";
import { assetReference, forgetAsset, rememberAsset } from "./asset-urls";

/**
 * The images uploaded to a project, in one place.
 *
 * Uploading already worked, but only from the inspector and only onto the node
 * that happened to be selected — so a picture used twice was uploaded twice,
 * and there was no way to see what a project already held. This lists them,
 * takes new ones, and applies one to the current selection.
 *
 * Images live on the server per project, so this is only available once the
 * project is signed in and synced; a local-only workspace is told so rather
 * than shown an empty shelf it cannot fill.
 */

export type ImageLibraryProps = {
  open: boolean;
  projectId: string | undefined;
  canApply: boolean;
  onClose(): void;
  onApply(reference: string): void;
};

const acceptable = "image/png,image/jpeg,image/webp,image/gif,image/svg+xml";

export function ImageLibrary({ open, projectId, canApply, onClose, onApply }: ImageLibraryProps) {
  const [assets, setAssets] = useState<UploadedAsset[]>([]);
  const [status, setStatus] = useState<string>();
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    if (!projectId) return;
    try {
      const list = await listAssets(projectId);
      for (const asset of list) rememberAsset(asset);
      setAssets(list);
      setStatus(list.length ? undefined : "No images yet. Add one to get started.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not load the image library");
    }
  }, [projectId]);

  useEffect(() => {
    if (open) void reload();
  }, [open, reload]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, open]);

  const add = useCallback(async (files: FileList | File[] | null) => {
    if (!projectId || !files?.length) return;
    setBusy(true);
    setStatus(undefined);
    try {
      for (const file of Array.from(files)) {
        const asset = await uploadAsset(projectId, file);
        rememberAsset(asset);
        setAssets((current) => [asset, ...current.filter((item) => item.id !== asset.id)]);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }, [projectId]);

  const remove = useCallback(async (asset: UploadedAsset) => {
    if (!window.confirm("Delete this image? Components using it will lose their background.")) return;
    try {
      await deleteAsset(asset.id);
      forgetAsset(asset.id);
      setAssets((current) => current.filter((item) => item.id !== asset.id));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not delete the image");
    }
  }, []);

  if (!open) return null;

  return (
    <div className="config-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section aria-label="Image library" aria-modal="true" className="config-dialog image-library" role="dialog">
        <header>
          <div>
            <span>INSERT</span>
            <h2>Image library</h2>
            <p>Pictures uploaded to this project. Pick one to use as the background of the selected component.</p>
          </div>
          <button aria-label="Close image library" onClick={onClose}>×</button>
        </header>

        {projectId ? (
          <>
            <div className="image-library-actions">
              <button
                className="primary"
                disabled={busy}
                onClick={() => fileInput.current?.click()}
              >{busy ? "Uploading…" : "Add images"}</button>
              <input
                accept={acceptable}
                aria-label="Image files"
                hidden
                multiple
                onChange={(event) => { void add(event.target.files); event.target.value = ""; }}
                ref={fileInput}
                type="file"
              />
              <small>{canApply ? "Click an image to apply it." : "Select a component first to apply one."}</small>
            </div>

            <div
              className="image-library-grid"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => { event.preventDefault(); void add(event.dataTransfer.files); }}
            >
              {assets.map((asset) => (
                <figure key={asset.id}>
                  <button
                    disabled={!canApply}
                    onClick={() => { onApply(assetReference(asset.id)); onClose(); }}
                    title={canApply ? "Use as background" : "Select a component first"}
                    type="button"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img alt="" src={asset.url} />
                  </button>
                  <figcaption>
                    <span>{Math.round((asset.bytes ?? 0) / 1024)} KB</span>
                    <button aria-label="Delete image" onClick={() => void remove(asset)} type="button">×</button>
                  </figcaption>
                </figure>
              ))}
              {assets.length === 0 ? <p className="image-library-empty">Drop images here, or use “Add images”.</p> : null}
            </div>
          </>
        ) : (
          <p className="image-library-empty">
            Images are stored with the project on the server. Sign in and save this project to use the library.
          </p>
        )}

        {status ? <p className="image-library-status">{status}</p> : null}
      </section>
    </div>
  );
}
