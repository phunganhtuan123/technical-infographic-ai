"use client";

import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { applyPlan, documentToPlan } from "@/modules/ai/diagram-ai";
import { AiAssistantProvider, AiConnectionSettings, GlobalAiComposer, ItemCommentThread, ProposalControls, useAiAssistant } from "@/modules/ai/ai-assistant";
import type { AiIntent, DiagramProposal } from "@/modules/ai/contracts";
import { DiagramCanvas, primitiveDragType, type DiagramCanvasHandle } from "@/modules/canvas/diagram-canvas";
import { ComponentIcon } from "@/modules/catalog/component-icon";
import { brandIconsSnapshot, ensureBrandIcons, roleColors, searchBrandIcons, technologyOptions } from "@/modules/catalog/catalog";
import { TechnologyIcon } from "@/modules/catalog/technology-icon";
import { compilePlan } from "@/modules/compiler/compile-plan";
import { createBlankDocument, primitiveDefinitions } from "@/modules/diagram/factory";
import type { DiagramDocument, DiagramFormat, DiagramScene, EdgeDirection, EdgeEffect, EdgeSemantics, EdgeStrokeStyle, NodeEffect, NodeFontFamily, NodeFontWeight, NodeRole, NodeTextAlign } from "@/modules/diagram/schema";
import { exportGif, exportHtml, exportPng, exportSvg, exportVideo, exportWorkspaceJson } from "@/modules/export/export-document";
import { architecturePlan } from "@/modules/fixtures/architecture-plan";
import { diagramSamples } from "@/modules/fixtures/diagram-samples";
import { AccountControl, AccountDialog, AiGatewayChip, ConflictDialog } from "@/modules/projects/account-panel";
import { MenuBar, type Menu, type MenuItem } from "@/modules/editor/menu-bar";
import { uploadAsset } from "@/modules/projects/api-client";
import { assetIdOf, assetReference, rememberAsset } from "@/modules/projects/asset-urls";
import { HistoryDialog } from "@/modules/projects/history-panel";
import { useCloudSync } from "@/modules/projects/cloud-sync";
import { loadWorkspaceState, saveWorkspaceState } from "@/modules/projects/local-project-store";
import { hydrateWorkspaceValue, parseWorkspaceFile } from "@/modules/projects/workspace-file";

const colorPresets = ["#63e6ff", "#b6ff5c", "#a78bfa", "#fbbf24", "#fb7185", "#60a5fa", "#f5f5f5"];
const textColorPresets = ["#f5f5f5", "#d4d4d4", "#a3a3a3", "#b6ff5c", "#63e6ff", "#a78bfa", "#fbbf24"];
const fontOptions: Array<{ value: NodeFontFamily; label: string }> = [
  { value: "geist-mono", label: "Geist Mono" },
  { value: "jetbrains-mono", label: "JetBrains Mono" },
  { value: "ibm-plex-mono", label: "IBM Plex Mono" },
  { value: "system-sans", label: "System Sans" },
];
// A cleared number field reads as "" and Number("") is 0, which used to snap a
// component to 0x0 with no undo. Keep the previous value until a real number
// is typed, then hold it inside the control's own range.
function numberFieldValue(raw: string, fallback: number, lower: number, upper: number) {
  if (raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(upper, Math.max(lower, parsed));
}

// Narrowest the canvas column is allowed to become while a panel is dragged.
const minimumCanvasWidth = 560;
const flowRoles = new Set<NodeRole>(["start", "process", "decision", "input-output", "end", "document", "subprocess", "manual-input", "preparation", "delay", "connector", "off-page", "merge", "stored-data"]);
const structureRoles = new Set<NodeRole>(["zone", "group"]);
const annotationRoles = new Set<NodeRole>(["text", "note"]);

function ConnectionPreview({ edge }: { edge: DiagramDocument["edges"][number] }) {
  const markerStart = edge.direction === "reverse" || edge.direction === "both";
  const markerEnd = edge.direction === "forward" || edge.direction === "both";
  return (
    <div className={`connection-preview effect-${edge.effect}${edge.animated ? " is-animated" : ""}`} style={{ "--preview-color": edge.color, "--preview-speed": `${edge.speed}s`, "--preview-width": `${edge.thickness}px` } as React.CSSProperties}>
      <i className={edge.strokeStyle}>{markerStart ? "‹" : ""}<b />{markerEnd ? "›" : ""}</i>
      <span>{edge.label || "Connection preview"}</span>
    </div>
  );
}

function sceneSnapshot(document: DiagramDocument, id: string, name: string): DiagramScene {
  return { id, name, mode: document.mode, title: document.title, purpose: document.purpose, nodes: document.nodes, edges: document.edges };
}

function normalizeWorkspace(document: DiagramDocument): DiagramDocument {
  if (document.scenes?.length) {
    const activeSceneId = document.scenes.some((scene) => scene.id === document.activeSceneId) ? document.activeSceneId! : document.scenes[0].id;
    const active = document.scenes.find((scene) => scene.id === activeSceneId)!;
    return { ...document, format: document.format ?? "16:9", workspaceTitle: document.workspaceTitle ?? document.title, activeSceneId, mode: active.mode, title: active.title, purpose: active.purpose, nodes: active.nodes, edges: active.edges };
  }
  const activeSceneId = `scene-${document.id}-1`;
  return { ...document, format: document.format ?? "16:9", workspaceTitle: document.workspaceTitle ?? document.title, activeSceneId, scenes: [sceneSnapshot(document, activeSceneId, "Technical story")] };
}

function syncActiveScene(document: DiagramDocument): DiagramDocument {
  if (!document.scenes?.length) return normalizeWorkspace(document);
  const activeSceneId = document.scenes.some((scene) => scene.id === document.activeSceneId) ? document.activeSceneId! : document.scenes[0].id;
  return {
    ...document,
    activeSceneId,
    scenes: document.scenes.map((scene) => scene.id === activeSceneId
      ? sceneSnapshot(document, scene.id, scene.name)
      : scene),
  };
}

function activateScene(document: DiagramDocument, sceneId: string): DiagramDocument {
  const synced = syncActiveScene(document);
  const scene = synced.scenes!.find((candidate) => candidate.id === sceneId);
  if (!scene) return synced;
  return { ...synced, activeSceneId: scene.id, mode: scene.mode, title: scene.title, purpose: scene.purpose, nodes: scene.nodes, edges: scene.edges };
}

const AssistedCanvas = forwardRef<DiagramCanvasHandle, { document: DiagramDocument; externalRevision: number; presenting?: boolean; onDocumentChange: (document: DiagramDocument) => void; onSelectionChange: (selection: { nodeIds: string[]; edgeIds: string[] }) => void }>(function AssistedCanvas({ presenting = false, ...props }, ref) {
  const ai = useAiAssistant();
  const locked = Boolean(ai.proposal) || presenting;
  return <DiagramCanvas {...props} document={ai.proposal?.document ?? props.document} externalRevision={props.externalRevision + (ai.proposal ? 1_000_000 : 0)} onDocumentChange={locked ? () => undefined : props.onDocumentChange} onSelectionChange={locked ? () => undefined : props.onSelectionChange} readOnly={locked} ref={ref} />;
});

// The curated catalog stays first — it is what the component library offers and
// what carries lane/category meaning. Searching past two characters pulls in the
// rest of simple-icons, loaded on demand the first time the field is focused.
function IconPicker({ matches, onSelect }: { matches: (technology?: string) => boolean; onSelect: (technology: string | undefined) => void }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "ready">(() => (brandIconsSnapshot() ? "ready" : "idle"));
  const needle = query.trim().toLowerCase();

  const loadIndex = useCallback(() => {
    if (brandIconsSnapshot()) {
      setStatus("ready");
      return;
    }
    setStatus("loading");
    void ensureBrandIcons().then(() => setStatus("ready")).catch(() => setStatus("idle"));
  }, []);

  const curatedIds = useMemo(() => new Set(technologyOptions.map((option) => option.id as string)), []);
  const curated = needle
    ? technologyOptions.filter((option) => option.label.toLowerCase().includes(needle) || option.id.includes(needle))
    : technologyOptions;
  const brandResults = needle.length >= 2 && status === "ready"
    ? searchBrandIcons(needle).filter((icon) => !curatedIds.has(icon.slug))
    : [];
  const total = curated.length + brandResults.length;

  return (
    <>
      <label className="search icon-search">
        <span>⌕</span>
        <input aria-label="Search technology icons" onChange={(event) => setQuery(event.target.value)} onFocus={loadIndex} placeholder="Search brand icons" value={query} />
      </label>
      <div className="icon-picker">
        <button aria-label="No technology icon" className={matches(undefined) ? "active" : ""} onClick={() => onSelect(undefined)} title="No icon">—</button>
        {curated.map((technology) => <button aria-label={`Use ${technology.label} icon`} className={matches(technology.id) ? "active" : ""} key={technology.id} onClick={() => onSelect(technology.id)} title={technology.label}><TechnologyIcon technology={technology.id} /></button>)}
        {brandResults.map((icon) => <button aria-label={`Use ${icon.title} icon`} className={matches(icon.slug) ? "active" : ""} key={icon.slug} onClick={() => onSelect(icon.slug)} title={icon.title}><TechnologyIcon technology={icon.slug} /></button>)}
      </div>
      {needle.length >= 2 ? <p className="icon-picker-status">{status === "loading" ? "Loading brand icons…" : status === "ready" ? `${total} match${total === 1 ? "" : "es"}` : "Focus the field to load brand icons"}</p> : null}
    </>
  );
}

/**
 * The AI gateway's state, next to the prompt field.
 *
 * It replaced a button labelled "Config", which could not tell you whether
 * anything was connected — and a model running on your own machine is the
 * rarest thing this editor does, so it should not be something you go hunting
 * for. Same shape as the account control, answering the same kind of question.
 */
function AiStatusChip({ onOpen }: { onOpen: () => void }) {
  const ai = useAiAssistant();
  const provider = ai.providers.find((candidate) => candidate.id === ai.providerId);
  return (
    <AiGatewayChip
      connected={ai.connected}
      model={ai.model}
      onOpen={onOpen}
      provider={provider?.label ?? (ai.gatewayOrigin ? "Client gateway" : undefined)}
    />
  );
}

export function EditorShell() {
  const initialDocument = useMemo(() => normalizeWorkspace(compilePlan(architecturePlan)), []);
  const [intent, setIntent] = useState<"build" | "publish">("build");
  const [workspaces, setWorkspaces] = useState<DiagramDocument[]>([initialDocument]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState(initialDocument.id);
  const [search, setSearch] = useState("");
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<string[]>([]);
  const [libraryView, setLibraryView] = useState<"tree" | "grid">("tree");
  const [libraryWidth, setLibraryWidth] = useState(240);
  const [libraryCollapsed, setLibraryCollapsed] = useState(false);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
  const [presenting, setPresenting] = useState(false);
  const [sceneTransition, setSceneTransition] = useState(false);
  const [componentListCollapsed, setComponentListCollapsed] = useState(false);
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set(["Technology"]));
  const [inspectorWidth, setInspectorWidth] = useState(240);
  const [aiState, setAiState] = useState<{ busy: boolean; message: string; source?: string }>({ busy: false, message: "Ready" });
  const [exporting, setExporting] = useState<"gif" | "video" | null>(null);
  const [externalRevision, setExternalRevision] = useState(0);
  const [documentRevision, setDocumentRevision] = useState(0);
  const [storageReady, setStorageReady] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<"content" | "style" | "layout">("content");
  const canvasRef = useRef<DiagramCanvasHandle>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const shellRef = useRef<HTMLElement>(null);
  const animationTimeout = useRef(0);
  const document = workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? workspaces[0];
  const selectedNodes = document.nodes.filter((node) => selectedNodeIds.includes(node.id));
  const selectedEdges = document.edges.filter((edge) => selectedEdgeIds.includes(edge.id));

  useEffect(() => {
    void loadWorkspaceState().then((state) => {
      if (state?.workspaces.length) {
        const normalized = state.workspaces.map((workspace) => normalizeWorkspace(applyPlan(workspace, documentToPlan(workspace))));
        setWorkspaces(normalized);
        setActiveWorkspaceId(state.workspaces.some((workspace) => workspace.id === state.activeWorkspaceId) ? state.activeWorkspaceId : state.workspaces[0].id);
        setExternalRevision((value) => value + 1);
      }
    }).catch(() => setAiState((current) => ({ ...current, message: "Local storage unavailable" }))).finally(() => setStorageReady(true));
  }, []);

  useEffect(() => {
    if (!storageReady) return;
    const timeout = window.setTimeout(() => {
      void saveWorkspaceState({ activeWorkspaceId, workspaces }).catch(() => setAiState((current) => ({ ...current, message: "Could not save locally" })));
    }, 280);
    return () => window.clearTimeout(timeout);
  }, [activeWorkspaceId, storageReady, workspaces]);

  const filteredPrimitives = primitiveDefinitions.filter((primitive) => `${primitive.label} ${primitive.detail}`.toLowerCase().includes(search.trim().toLowerCase()));
  const updateWorkspace = useCallback((updated: DiagramDocument) => {
    setWorkspaces((current) => current.map((workspace) => workspace.id === updated.id ? syncActiveScene(updated) : workspace));
    setDocumentRevision((value) => value + 1);
  }, []);

  // Cloud sync. Signed out, none of this runs and the editor stays exactly what
  // it was: one browser, one IndexedDB, no network.
  const hydrateRemote = useCallback((raw: unknown) => {
    try {
      return normalizeWorkspace(hydrateWorkspaceValue(raw));
    } catch {
      // A document this version cannot read is left on the server untouched
      // rather than dropped or half-imported.
      return null;
    }
  }, []);

  const adoptRemote = useCallback((documents: DiagramDocument[]) => {
    setWorkspaces((current) => {
      const known = new Set(current.map((workspace) => workspace.id));
      const arrivals = documents.filter((document) => !known.has(document.id));
      return arrivals.length ? [...current, ...arrivals] : current;
    });
    setExternalRevision((value) => value + 1);
  }, []);

  const replaceRemote = useCallback((document: DiagramDocument) => {
    setWorkspaces((current) => current.map((workspace) => workspace.id === document.id ? document : workspace));
    setSelectedNodeIds([]);
    setSelectedEdgeIds([]);
    setExternalRevision((value) => value + 1);
  }, []);

  const {
    session,
    state: syncState,
    conflict: syncConflict,
    signIn,
    createAccount,
    signOut,
    resolveConflict,
    forget: forgetRemote,
    syncNow,
    projectIdFor,
    versionOf,
    restoreTo,
  } = useCloudSync({ workspaces, activeWorkspaceId, ready: storageReady, hydrate: hydrateRemote, onAdopt: adoptRemote, onReplace: replaceRemote });

  const createWorkspace = useCallback(() => {
    const workspace = normalizeWorkspace(createBlankDocument(`workspace-${crypto.randomUUID()}`, `Untitled ${workspaces.length + 1}`));
    setWorkspaces((current) => [...current, workspace]);
    setActiveWorkspaceId(workspace.id);
    setSelectedNodeIds([]);
    setSelectedEdgeIds([]);
    setIntent("build");
  }, [workspaces.length]);

  const createSampleWorkspace = useCallback((sample: (typeof diagramSamples)[number]) => {
    const workspace = normalizeWorkspace(compilePlan({ ...sample.plan, id: `sample-${sample.id}-${crypto.randomUUID()}` }));
    setWorkspaces((current) => [...current, workspace]);
    setActiveWorkspaceId(workspace.id);
    setSelectedNodeIds([]);
    setSelectedEdgeIds([]);
    setExternalRevision((value) => value + 1);
  }, []);

  const duplicateWorkspace = useCallback(() => {
    const copy = structuredClone(document);
    copy.id = `workspace-${crypto.randomUUID()}`;
    copy.workspaceTitle = `${document.workspaceTitle ?? document.title} · copy`;
    setWorkspaces((current) => [...current, copy]);
    setActiveWorkspaceId(copy.id);
    setSelectedNodeIds([]);
    setSelectedEdgeIds([]);
  }, [document]);

  const saveAsWorkspace = useCallback(() => {
    const name = window.prompt("Save workspace as", `${document.workspaceTitle ?? document.title} · copy`)?.trim();
    if (!name) return;
    const copy = structuredClone(document);
    copy.id = `workspace-${crypto.randomUUID()}`;
    copy.workspaceTitle = name;
    setWorkspaces((current) => [...current, copy]);
    setActiveWorkspaceId(copy.id);
    setSelectedNodeIds([]);
    setSelectedEdgeIds([]);
    setAiState({ busy: false, message: `Saved as ${name}` });
  }, [document]);

  const importWorkspace = useCallback(async (file: File) => {
    try {
      const imported = parseWorkspaceFile(await file.text());
      const workspace = normalizeWorkspace({ ...imported, id: `workspace-${crypto.randomUUID()}`, workspaceTitle: imported.workspaceTitle ?? imported.title });
      setWorkspaces((current) => [...current, workspace]);
      setActiveWorkspaceId(workspace.id);
      setSelectedNodeIds([]);
      setSelectedEdgeIds([]);
      setExternalRevision((value) => value + 1);
      setAiState({ busy: false, message: `Imported ${workspace.workspaceTitle}` });
    } catch (error) {
      setAiState({ busy: false, message: error instanceof Error ? `Import failed: ${error.message}` : "Import failed" });
    }
  }, []);

  const deleteWorkspace = useCallback(() => {
    if (workspaces.length === 1 || !window.confirm(`Delete workspace “${document.workspaceTitle ?? document.title}”?`)) return;
    const remaining = workspaces.filter((workspace) => workspace.id !== document.id);
    setWorkspaces(remaining);
    setActiveWorkspaceId(remaining[0].id);
    setSelectedNodeIds([]);
    setSelectedEdgeIds([]);
    // Without this the next sync would pull the project straight back in.
    void forgetRemote(document.id);
  }, [document.id, document.title, document.workspaceTitle, forgetRemote, workspaces]);

  const switchScene = useCallback((sceneId: string) => {
    updateWorkspace(activateScene(document, sceneId));
    setSelectedNodeIds([]);
    setSelectedEdgeIds([]);
    setExternalRevision((value) => value + 1);
  }, [document, updateWorkspace]);

  // Presentation mode reuses Scenes as slides: the chrome is hidden, the canvas
  // is locked, and left/right step through the scenes of this workspace.
  const scenes = document.scenes ?? [];
  const activeSceneIndex = Math.max(0, scenes.findIndex((scene) => scene.id === document.activeSceneId));

  const goToScene = useCallback((index: number) => {
    const list = document.scenes ?? [];
    const target = list[index];
    if (!target || target.id === document.activeSceneId) return;
    setSceneTransition(true);
    window.setTimeout(() => setSceneTransition(false), 260);
    switchScene(target.id);
  }, [document.activeSceneId, document.scenes, switchScene]);

  const startPresenting = useCallback(() => {
    setSelectedNodeIds([]);
    setSelectedEdgeIds([]);
    setIntent("publish");
    setPresenting(true);
    setExternalRevision((value) => value + 1);
  }, []);

  // No revision bump on the way out: the canvas ResizeObserver re-fits on its
  // own once the panels come back, and the undo history survives the trip.
  const stopPresenting = useCallback(() => {
    setPresenting(false);
  }, []);

  useEffect(() => {
    if (!presenting) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        stopPresenting();
        return;
      }
      if (event.key === "ArrowRight" || event.key === "PageDown" || event.key === " ") {
        event.preventDefault();
        goToScene(activeSceneIndex + 1);
      }
      if (event.key === "ArrowLeft" || event.key === "PageUp") {
        event.preventDefault();
        goToScene(activeSceneIndex - 1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeSceneIndex, goToScene, presenting, stopPresenting]);

  const createScene = useCallback(() => {
    const synced = syncActiveScene(document);
    const id = `scene-${crypto.randomUUID()}`;
    const blank = createBlankDocument(document.id, `Scene ${synced.scenes!.length + 1}`);
    const scene = sceneSnapshot(blank, id, `Scene ${synced.scenes!.length + 1}`);
    updateWorkspace({ ...synced, activeSceneId: id, scenes: [...synced.scenes!, scene], mode: scene.mode, title: scene.title, purpose: scene.purpose, nodes: [], edges: [] });
    setSelectedNodeIds([]);
    setSelectedEdgeIds([]);
    setExternalRevision((value) => value + 1);
  }, [document, updateWorkspace]);

  const duplicateScene = useCallback(() => {
    const synced = syncActiveScene(document);
    const active = synced.scenes!.find((scene) => scene.id === synced.activeSceneId)!;
    const copy = structuredClone(active);
    copy.id = `scene-${crypto.randomUUID()}`;
    copy.name = `${active.name} · copy`;
    updateWorkspace({ ...synced, activeSceneId: copy.id, scenes: [...synced.scenes!, copy], mode: copy.mode, title: copy.title, purpose: copy.purpose, nodes: copy.nodes, edges: copy.edges });
    setSelectedNodeIds([]);
    setSelectedEdgeIds([]);
    setExternalRevision((value) => value + 1);
  }, [document, updateWorkspace]);

  const deleteScene = useCallback(() => {
    const synced = syncActiveScene(document);
    if (synced.scenes!.length === 1) return;
    const active = synced.scenes!.find((scene) => scene.id === synced.activeSceneId)!;
    if (!window.confirm(`Delete scene “${active.name}”?`)) return;
    const remaining = synced.scenes!.filter((scene) => scene.id !== active.id);
    const next = remaining[0];
    updateWorkspace({ ...synced, activeSceneId: next.id, scenes: remaining, mode: next.mode, title: next.title, purpose: next.purpose, nodes: next.nodes, edges: next.edges });
    setSelectedNodeIds([]);
    setSelectedEdgeIds([]);
    setExternalRevision((value) => value + 1);
  }, [document, updateWorkspace]);

  const renameScene = useCallback((name: string) => {
    const synced = syncActiveScene(document);
    updateWorkspace({ ...synced, scenes: synced.scenes!.map((scene) => scene.id === synced.activeSceneId ? { ...scene, name } : scene) });
  }, [document, updateWorkspace]);

  // Collapse and expand are the only layout changes that should animate. The
  // class is added for the length of the transition and taken off again, so a
  // window resize or a pointer drag never inherits it. (Fixes 01, 07 and 10.)
  const animateLayout = useCallback((change: () => void) => {
    const shell = shellRef.current;
    if (shell) {
      shell.classList.add("is-animating");
      window.clearTimeout(animationTimeout.current);
      animationTimeout.current = window.setTimeout(() => shell.classList.remove("is-animating"), 200);
    }
    change();
  }, []);

  useEffect(() => () => window.clearTimeout(animationTimeout.current), []);

  // One handler for both panels. While the pointer is down the width is written
  // straight to the CSS variable once per frame — no React state, so nothing
  // re-renders — and committed to state exactly once on release.
  // (Fixes 02, 03, 04 and 06.)
  const startResize = useCallback((event: React.PointerEvent<HTMLDivElement>, side: "left" | "right") => {
    const shell = shellRef.current;
    if (!shell) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    shell.classList.add("is-resizing");

    const isLeft = side === "left";
    const variable = isLeft ? "--library-width" : "--inspector-width";
    const startX = event.clientX;
    const startWidth = isLeft ? libraryWidth : inspectorWidth;
    const otherWidth = isLeft ? inspectorWidth : libraryWidth;
    const lower = isLeft ? 240 : 220;
    // The upper bound follows the live window width so the drag stops where the
    // canvas would be squeezed out, instead of at a fixed number that silently
    // clips the far panel on smaller screens.
    const upper = Math.max(lower, Math.min(isLeft ? 420 : 460, window.innerWidth - otherWidth - minimumCanvasWidth));
    let frame = 0;
    let width = startWidth;

    const onMove = (moveEvent: PointerEvent) => {
      const delta = isLeft ? moveEvent.clientX - startX : startX - moveEvent.clientX;
      width = Math.min(upper, Math.max(lower, startWidth + delta));
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        shell.style.setProperty(variable, `${width}px`);
      });
    };

    const onEnd = () => {
      window.cancelAnimationFrame(frame);
      shell.classList.remove("is-resizing");
      if (isLeft) setLibraryWidth(width);
      else setInspectorWidth(width);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd, { once: true });
    window.addEventListener("pointercancel", onEnd, { once: true });
  }, [inspectorWidth, libraryWidth]);

  const handleSelection = useCallback(({ nodeIds, edgeIds }: { nodeIds: string[]; edgeIds: string[] }) => {
    setSelectedNodeIds(nodeIds);
    setSelectedEdgeIds(edgeIds);
  }, []);

  const acceptAiProposal = useCallback((next: DiagramDocument, proposalIntent: AiIntent, proposal: DiagramProposal) => {
    if (proposalIntent === "new-scene") {
      const synced = syncActiveScene(document);
      const sceneId = `scene-${crypto.randomUUID()}`;
      const nextScene = sceneSnapshot(next, sceneId, proposal.summary.slice(0, 48));
      if (!document.nodes.length && !document.edges.length) {
        const activeId = synced.activeSceneId!;
        const activeScene = { ...nextScene, id: activeId, name: synced.scenes!.find((scene) => scene.id === activeId)?.name ?? nextScene.name };
        updateWorkspace({ ...synced, mode: next.mode, title: next.title, purpose: next.purpose, nodes: next.nodes, edges: next.edges, scenes: synced.scenes!.map((scene) => scene.id === activeId ? activeScene : scene) });
      } else {
        updateWorkspace({ ...synced, activeSceneId: sceneId, mode: next.mode, title: next.title, purpose: next.purpose, nodes: next.nodes, edges: next.edges, scenes: [...synced.scenes!, nextScene] });
      }
    } else updateWorkspace({ ...next, id: document.id, workspaceTitle: document.workspaceTitle, scenes: document.scenes, activeSceneId: document.activeSceneId });
    setSelectedNodeIds([]); setSelectedEdgeIds([]); setExternalRevision((value) => value + 1);
  }, [document, updateWorkspace]);

  const updateSelected = useCallback((updates: { label?: string; detail?: string; caption?: string; note?: string; role?: NodeRole; color?: string; textColor?: string; fontFamily?: NodeFontFamily; fontSize?: number; fontWeight?: NodeFontWeight; textAlign?: NodeTextAlign; technology?: string; borderStyle?: EdgeStrokeStyle; borderWidth?: number; effect?: NodeEffect; speed?: number; size?: { width: number; height: number }; backgroundImage?: string; backgroundOpacity?: number; backgroundFit?: "cover" | "contain"; zIndex?: number }) => {
    const roleUpdates = updates.role ? {
      role: updates.role,
      color: roleColors[updates.role],
      lane: (updates.role === "database" || updates.role === "cache" || updates.role === "stored-data" ? "data" : updates.role === "event-bus" || updates.role === "worker" ? "async" : updates.role === "actor" || updates.role === "start" || updates.role === "manual-input" ? "entry" : "core") as DiagramDocument["nodes"][number]["lane"],
    } : {};
    canvasRef.current?.updateNodes(selectedNodeIds, { ...updates, ...roleUpdates });
  }, [selectedNodeIds]);

  // Uploading beats inlining: a 400 KB photo becomes ~533 KB of base64 inside
  // the document, and the editor autosaves that into the project *and* a row of
  // version history every few seconds. The document keeps a stable reference
  // instead. Signed out, or before this workspace has ever synced, there is
  // nowhere to upload to and base64 remains the honest fallback — the editor
  // has always worked without an account and still does.
  const setBackgroundImage = useCallback(async (file: File) => {
    const projectId = projectIdFor(document.id);
    if (!projectId) {
      const reader = new FileReader();
      reader.onload = () => updateSelected({ backgroundImage: String(reader.result) });
      reader.readAsDataURL(file);
      return;
    }
    setAiState({ busy: true, message: `Uploading ${file.name}…` });
    try {
      const asset = await uploadAsset(projectId, file);
      rememberAsset(asset);
      updateSelected({ backgroundImage: assetReference(asset.id) });
      setAiState({ busy: false, message: `Uploaded ${file.name}` });
    } catch (error) {
      setAiState({ busy: false, message: error instanceof Error ? error.message : "Could not upload that image" });
    }
  }, [document.id, projectIdFor, updateSelected]);

  const updateSelectedEdges = useCallback((updates: { label?: string; semantics?: EdgeSemantics; direction?: EdgeDirection; thickness?: number; animated?: boolean; color?: string; strokeStyle?: EdgeStrokeStyle; effect?: EdgeEffect; speed?: number; routeWaypoints?: DiagramDocument["edges"][number]["routeWaypoints"] | null; routeWaypoint?: DiagramDocument["edges"][number]["routeWaypoint"] | null }) => {
    canvasRef.current?.updateEdges(selectedEdgeIds, updates);
  }, [selectedEdgeIds]);

  const setDocumentFormat = useCallback((format: DiagramFormat) => {
    updateWorkspace({ ...document, format });
    setExternalRevision((value) => value + 1);
  }, [document, updateWorkspace]);

  const runAnimatedExport = useCallback(async (format: "gif" | "video") => {
    if (exporting) return;
    setExporting(format);
    setAiState((current) => ({ ...current, message: `Rendering ${format === "gif" ? "animated GIF" : "WebM video"}…` }));
    try {
      if (format === "gif") await exportGif(document);
      else await exportVideo(document);
      setAiState((current) => ({ ...current, message: `${format === "gif" ? "GIF" : "Video"} export ready` }));
    } catch (error) {
      setAiState((current) => ({ ...current, message: error instanceof Error ? error.message : "Export failed" }));
    } finally {
      setExporting(null);
    }
  }, [document, exporting]);

  const primitiveGroups = [
    ["Technology", filteredPrimitives.filter((primitive) => primitive.technology)],
    ["Structure", filteredPrimitives.filter((primitive) => !primitive.technology && structureRoles.has(primitive.role))],
    ["Annotation", filteredPrimitives.filter((primitive) => !primitive.technology && annotationRoles.has(primitive.role))],
    ["Flow", filteredPrimitives.filter((primitive) => !primitive.technology && flowRoles.has(primitive.role))],
    ["Entry", filteredPrimitives.filter((primitive) => !primitive.technology && primitive.lane === "entry" && !flowRoles.has(primitive.role) && !structureRoles.has(primitive.role))],
    ["Core", filteredPrimitives.filter((primitive) => !primitive.technology && primitive.lane === "core" && !flowRoles.has(primitive.role) && !structureRoles.has(primitive.role) && !annotationRoles.has(primitive.role))],
    ["Async", filteredPrimitives.filter((primitive) => !primitive.technology && primitive.lane === "async" && !flowRoles.has(primitive.role) && !structureRoles.has(primitive.role))],
    ["Data", filteredPrimitives.filter((primitive) => !primitive.technology && primitive.lane === "data" && !flowRoles.has(primitive.role) && !structureRoles.has(primitive.role))],
  ] as const;

  // Every command the editor has, grouped where somebody would look for it.
  // A command with no `run` renders as "soon" — listed on purpose, so the menu
  // does not have to be reorganised when it lands.
  const command = (label: string, run?: () => void, extra: Partial<MenuItem & { kind: "command" }> = {}) =>
    ({ kind: "command" as const, label, run, ...extra });
  const separator = { kind: "separator" as const };
  const heading = (label: string) => ({ kind: "heading" as const, label });
  const scenes_ = document.scenes ?? [];

  const menus: Menu[] = [
    { label: "File", items: [
      command("New workspace", createWorkspace),
      command("Duplicate", duplicateWorkspace),
      command("Save as…", saveAsWorkspace),
      separator,
      command("Import workspace JSON…", () => importInputRef.current?.click()),
      command("Import Mermaid…"),
      command("Import PlantUML…"),
      separator,
      command("Version history…", () => setHistoryOpen(true)),
      command("Delete workspace", deleteWorkspace, { disabled: workspaces.length === 1 }),
    ] },
    { label: "Edit", items: [
      command("Undo", () => canvasRef.current?.undo(), { hint: "⌘Z" }),
      command("Redo", () => canvasRef.current?.redo(), { hint: "⇧⌘Z" }),
      separator,
      command("Delete selection", () => canvasRef.current?.deleteSelection(selectedNodeIds, selectedEdgeIds), {
        hint: "⌫", disabled: selectedNodeIds.length === 0 && selectedEdgeIds.length === 0,
      }),
      separator,
      command("Group", () => canvasRef.current?.groupSelection(selectedNodeIds), { disabled: selectedNodeIds.length < 2 }),
      command("Ungroup", () => canvasRef.current?.ungroupSelection(selectedNodeIds), { disabled: selectedNodeIds.length === 0 }),
      command("Reset auto-route", () => updateSelectedEdges({ routeWaypoints: null, routeWaypoint: null }), {
        disabled: selectedEdgeIds.length === 0,
      }),
    ] },
    { label: "View", items: [
      command("Build", () => setIntent("build"), { checked: intent === "build" }),
      command("Publish", () => setIntent("publish"), { checked: intent === "publish" }),
      separator,
      command("Fit to view", () => canvasRef.current?.fitToView()),
      separator,
      command(libraryCollapsed ? "Show left panel" : "Hide left panel", () => animateLayout(() => setLibraryCollapsed((value) => !value))),
      command(inspectorCollapsed ? "Show right panel" : "Hide right panel", () => animateLayout(() => setInspectorCollapsed((value) => !value))),
      command(componentListCollapsed ? "Show component list" : "Hide component list", () => setComponentListCollapsed((value) => !value)),
    ] },
    { label: "Insert", items: [
      heading("Components"),
      ...primitiveGroups.slice(0, 4).map(([group, primitives]) =>
        command(`${group}…`, primitives.length ? () => { setSearch(""); setComponentListCollapsed(false); setCollapsedCategories((current) => { const next = new Set(current); next.delete(group); return next; }); } : undefined,
          { hint: String(primitives.length) })),
      separator,
      command("Background image…", () => setInspectorCollapsed(false), { disabled: selectedNodeIds.length === 0 }),
      command("Image library…"),
    ] },
    { label: "AI", items: [
      heading("Gateway"),
      command("Connect a gateway…", () => setConfigOpen(true)),
      command("Settings…", () => setConfigOpen(true)),
      separator,
      heading("Generate"),
      command("Generate a diagram…", () => setInspectorCollapsed(false), { hint: "⌘K" }),
      command("Explain this diagram"),
      separator,
      command("Conversation panel", () => setConfigOpen(true)),
    ] },
    { label: "Arrange", items: [
      command("Auto-layout", () => void canvasRef.current?.arrange(), { disabled: document.nodes.length === 0 }),
      separator,
      command("Bring to front", () => updateSelected({ zIndex: Math.min(100, (selectedNodes[0]?.zIndex ?? 1) + 1) }), { disabled: selectedNodeIds.length === 0 }),
      command("Send to back", () => updateSelected({ zIndex: Math.max(-20, (selectedNodes[0]?.zIndex ?? 1) - 1) }), { disabled: selectedNodeIds.length === 0 }),
      separator,
      heading("Canvas format"),
      ...(["16:9", "1:1", "4:5", "9:16", "full"] as DiagramFormat[]).map((format) =>
        command(format === "full" ? "Full" : format, () => setDocumentFormat(format), { checked: (document.format ?? "16:9") === format })),
    ] },
    { label: "Export", items: [
      heading("Keeps the animation"),
      command("SVG animated", () => void exportSvg(document), { disabled: Boolean(exporting) }),
      command("HTML animated", () => void exportHtml(document), { disabled: Boolean(exporting) }),
      command(exporting === "gif" ? "Rendering GIF…" : "GIF animated", () => void runAnimatedExport("gif"), { disabled: Boolean(exporting) }),
      command(exporting === "video" ? "Recording video…" : "Video WebM", () => void runAnimatedExport("video"), { disabled: Boolean(exporting) }),
      separator,
      heading("Still"),
      command("PNG 2×", () => void exportPng(document), { disabled: Boolean(exporting) }),
      command("PDF"),
      separator,
      command("Workspace JSON", () => void exportWorkspaceJson(document)),
    ] },
    { label: "Help", items: [
      command("Account…", () => setAccountOpen(true)),
      separator,
      command("Keyboard shortcuts"),
      command("Documentation"),
    ] },
  ];

  // The active workspace's own ⋯ — what used to be a name field and three
  // buttons taking permanent space in the panel.
  const workspaceMenu: Menu[] = [{ label: "⋯", items: [
    command("Rename…", () => {
      const name = window.prompt("Rename workspace", document.workspaceTitle ?? document.title)?.trim();
      if (name) updateWorkspace({ ...document, workspaceTitle: name });
    }),
    command("Duplicate", duplicateWorkspace),
    command("Save as…", saveAsWorkspace),
    separator,
    command("Version history…", () => setHistoryOpen(true)),
    separator,
    command("Delete", deleteWorkspace, { disabled: workspaces.length === 1 }),
  ] }];

  // The scene row's own ⋯ — the commands that used to be three buttons.
  const sceneMenu: Menu[] = [{ label: "⋯", items: [
    command("Add scene", createScene),
    command("Duplicate scene", duplicateScene),
    command("Rename scene…", () => {
      const active = scenes_.find((scene) => scene.id === document.activeSceneId);
      const name = window.prompt("Rename scene", active?.name ?? "")?.trim();
      if (name) renameScene(name);
    }),
    separator,
    command("Delete scene", deleteScene, { disabled: scenes_.length === 1 }),
  ] }];

  const renderPrimitive = (primitive: (typeof primitiveDefinitions)[number]) => (
    <button draggable key={`${primitive.role}-${primitive.technology ?? primitive.label}`} onClick={() => canvasRef.current?.insertPrimitive(primitive)} onDragStart={(event) => { event.dataTransfer.setData(primitiveDragType, JSON.stringify(primitive)); event.dataTransfer.effectAllowed = "copy"; }} title={`Add ${primitive.label}`}>
      {primitive.technology ? <TechnologyIcon technology={primitive.technology} /> : <ComponentIcon role={primitive.role} />}<span className="primitive-copy"><span className="primitive-name">{primitive.label}</span><small>{primitive.detail}</small></span><span className="primitive-add">＋</span>
    </button>
  );


  return (
    <AiAssistantProvider document={document} revision={documentRevision} selectedNodeIds={selectedNodeIds} selectedEdgeIds={selectedEdgeIds} onAccept={acceptAiProposal}>
    <main className={`app-shell${presenting ? " is-presenting" : ""}`} ref={shellRef} style={{ "--library-width": libraryCollapsed ? "44px" : `${libraryWidth}px`, "--inspector-width": inspectorCollapsed ? "44px" : `${inspectorWidth}px` } as React.CSSProperties}>
      <header className="topbar">
        <div className="brand"><i /> Technical Infographic <span>alpha</span></div>
        <MenuBar menus={menus} />
        <input accept="application/json,.json" aria-label="Workspace JSON file" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void importWorkspace(file); event.currentTarget.value = ""; }} ref={importInputRef} type="file" />
        <div className="top-actions">
          <div className="intent-switch" aria-label="Workspace intent"><button className={intent === "build" ? "active" : ""} onClick={() => setIntent("build")}>Build</button><button className={intent === "publish" ? "active" : ""} onClick={() => setIntent("publish")}>Publish</button></div>
          <button aria-label="Start presentation" className="present" disabled={document.nodes.length === 0} onClick={startPresenting} title="Present scenes (Esc to exit)">▶ Present</button>
          <AccountControl onOpen={() => setAccountOpen(true)} session={session} state={syncState} />
        </div>
      </header>

      {/* One row where a 132 px header used to be. The title is a breadcrumb
          rather than a heading — it is not editable here and never was — and the
          composer keeps its full panel, it just stops reserving a band across
          the top while you drag boxes. */}
      <div className="context-row">
        <span className="context-crumb">
          <small>{document.mode.toUpperCase()}</small>
          <strong title={document.workspaceTitle ?? document.title}>{document.workspaceTitle ?? document.title}</strong>
        </span>
        <p className="context-purpose" title={document.purpose}>{document.purpose}</p>
        <div className="context-ai">
          <GlobalAiComposer hasNodes={document.nodes.length > 0} currentFormat={document.format ?? "16:9"} />
          <AiStatusChip onOpen={() => setConfigOpen(true)} />
        </div>
      </div>

      <section className="workspace">
        <aside className={`library-panel${libraryCollapsed ? " is-collapsed" : ""}`}>
          <button aria-label={libraryCollapsed ? "Expand left panel" : "Collapse left panel"} className="library-collapse" onClick={() => animateLayout(() => setLibraryCollapsed((value) => !value))}>{libraryCollapsed ? "›" : "‹"}</button>
          <div aria-hidden="true" className="library-resizer" onPointerDown={(event) => startResize(event, "left")} />
          <div className="panel-heading"><span>WORKSPACES</span><button aria-label="Create workspace" className="panel-add" onClick={createWorkspace}>＋</button></div>
          <div className="workspace-list">{workspaces.map((workspace, index) => (
            <div className={`workspace-row${workspace.id === activeWorkspaceId ? " active" : ""}`} key={workspace.id}>
              <button onClick={() => { setActiveWorkspaceId(workspace.id); setSelectedNodeIds([]); setSelectedEdgeIds([]); }}>
                <i>{String(index + 1).padStart(2, "0")}</i>
                <span>{workspace.workspaceTitle ?? workspace.title}</span>
                <small>{workspace.scenes?.length ?? 1}</small>
              </button>
              {workspace.id === activeWorkspaceId ? <MenuBar menus={workspaceMenu} /> : null}
            </div>
          ))}</div>
          <details className="sample-library">
            <summary><span>CHART EXAMPLES</span><b>{diagramSamples.length}</b></summary>
            <div>{diagramSamples.map((sample) => <button key={sample.id} onClick={() => createSampleWorkspace(sample)}><i>{String(sample.number).padStart(2, "0")}</i><strong>{sample.label}</strong><small>{sample.description}</small></button>)}</div>
          </details>
          <div className="library-divider" />
          <div className="panel-heading"><span>COMPONENTS</span><div className="component-panel-actions"><button aria-label={componentListCollapsed ? "Expand component list" : "Collapse component list"} onClick={() => setComponentListCollapsed((value) => !value)}>{componentListCollapsed ? "Show" : "Hide"}</button><div className="library-view-switch"><button aria-label="Tree component view" className={libraryView === "tree" ? "active" : ""} onClick={() => setLibraryView("tree")}>Tree</button><button aria-label="Grid component view" className={libraryView === "grid" ? "active" : ""} onClick={() => setLibraryView("grid")}>Grid</button></div></div></div>
          {!componentListCollapsed ? <><label className="search"><span>⌕</span><input aria-label="Search primitives" onChange={(event) => setSearch(event.target.value)} placeholder="Search technology" value={search} /></label>
          <div className={`primitive-tree primitive-tree--${libraryView}`}>{primitiveGroups.map(([group, primitives]) => primitives.length ? <details open={search.trim().length > 0 || !collapsedCategories.has(group)} key={group}><summary onClick={(event) => { event.preventDefault(); setCollapsedCategories((current) => { const next = new Set(current); if (next.has(group)) next.delete(group); else next.add(group); return next; }); }}><span>{group}</span><b>{primitives.length}</b></summary><div className={`primitive-list primitive-list--${libraryView}`}>{primitives.map(renderPrimitive)}</div></details> : null)}</div></> : <div className="component-list-collapsed">Component library hidden</div>}
          <div className="provider-block"><span>PROVIDERS & STACKS</span><div><b>AWS</b><b>GCP</b><b>K8s</b><b>+{Math.max(0, technologyOptions.length - 3)}</b></div></div>
        </aside>

        <section className="editor-main">
          <div className={`canvas-stage${sceneTransition ? " is-scene-change" : ""}`} data-format={document.format ?? "16:9"} data-intent={presenting ? "publish" : intent}>
            <AssistedCanvas document={document} externalRevision={externalRevision} onDocumentChange={updateWorkspace} onSelectionChange={handleSelection} presenting={presenting} ref={canvasRef} />
            <ProposalControls />
          </div>
          {/* A page-tab row. 86 px of cards, a name field and three buttons became
              30 px of chips: rename on double-click, everything else on the ⋯ —
              which is where you would look for it anyway. */}
          <div className="scene-strip">
            <div className="scene-list">
              {document.scenes!.map((scene, index) => (
                <button
                  className={`scene${scene.id === document.activeSceneId ? " active" : ""}`}
                  key={scene.id}
                  onClick={() => switchScene(scene.id)}
                  onDoubleClick={() => {
                    const name = window.prompt("Rename scene", scene.name)?.trim();
                    if (name) { switchScene(scene.id); renameScene(name); }
                  }}
                  title={`${scene.name} · ${scene.nodes.length} components · double-click to rename`}
                >
                  <i>{String(index + 1).padStart(2, "0")}</i>
                  <b>{scene.name}</b>
                  <em>{scene.nodes.length}</em>
                </button>
              ))}
              <button aria-label="Add scene" className="scene-add" onClick={createScene} title="Add a scene">＋</button>
            </div>
            <MenuBar menus={sceneMenu} />
          </div>
        </section>

        <aside className={`inspector-panel${inspectorCollapsed ? " is-collapsed" : ""}`}>
          <button aria-label={inspectorCollapsed ? "Expand right panel" : "Collapse right panel"} className="inspector-collapse" onClick={() => animateLayout(() => setInspectorCollapsed((value) => !value))}>{inspectorCollapsed ? "‹" : "›"}</button>
          <div aria-hidden="true" className="inspector-resizer" onPointerDown={(event) => startResize(event, "right")} />
          <div className="panel-heading"><span>INSPECTOR</span><i className="live-dot" /></div>
          {selectedEdges.length ? (
            <section className="selection-editor edge-editor">
              <label>CONNECTION · {selectedEdges.length}</label>
              {selectedEdges.length === 1 ? <ConnectionPreview edge={selectedEdges[0]} /> : null}
              <button aria-label="Reset connection route" className="focus-ai" disabled={selectedEdges.every((edge) => !edge.routeWaypoint && !edge.routeWaypoints?.length)} onClick={() => updateSelectedEdges({ routeWaypoints: null, routeWaypoint: null })}>Reset auto-route</button>
              {selectedEdges.length === 1 ? <><span>Caption</span><input aria-label="Connection caption" placeholder="Optional middle caption" value={selectedEdges[0].label ?? ""} onChange={(event) => updateSelectedEdges({ label: event.target.value })} /></> : <p>Changes apply to all selected connections.</p>}
              <span>Direction</span>
              <select aria-label="Connection direction" value={selectedEdges.length === 1 ? selectedEdges[0].direction : ""} onChange={(event) => updateSelectedEdges({ direction: event.target.value as EdgeDirection })}>
                {selectedEdges.length > 1 ? <option value="" disabled>Choose direction</option> : null}
                <option value="forward">Forward →</option><option value="reverse">Reverse ←</option><option value="both">Bidirectional ↔</option><option value="none">No arrow</option>
              </select>
              <span>Type</span>
              <select aria-label="Connection type" value={selectedEdges.length === 1 ? selectedEdges[0].semantics : ""} onChange={(event) => updateSelectedEdges({ semantics: event.target.value as EdgeSemantics })}>
                {selectedEdges.length > 1 ? <option value="" disabled>Choose type</option> : null}
                <option value="request">Request</option><option value="event">Event</option><option value="data">Data</option><option value="feedback">Feedback</option><option value="success">Success</option><option value="failure">Failure</option>
              </select>
              <span>Component color</span>
              <div className="color-editor">
                {colorPresets.map((color) => <button aria-label={`Set connection color ${color}`} className={selectedEdges.every((edge) => edge.color.toLowerCase() === color) ? "active" : ""} key={color} onClick={() => updateSelectedEdges({ color })} style={{ "--swatch": color } as React.CSSProperties} />)}
                <label title="Custom connection color"><input aria-label="Custom connection color" type="color" value={selectedEdges[0].color} onChange={(event) => updateSelectedEdges({ color: event.target.value })} /><i /></label>
              </div>
              <span>Line style</span>
              <div className="line-style-picker">
                {(["solid", "dashed", "dotted"] as EdgeStrokeStyle[]).map((style) => <button aria-label={`${style} connection`} className={selectedEdges.every((edge) => edge.strokeStyle === style) ? "active" : ""} key={style} onClick={() => updateSelectedEdges({ strokeStyle: style })}><i className={style} />{style}</button>)}
              </div>
              <span>Thickness · {(selectedEdges[0]?.thickness ?? 1.8).toFixed(1)} px</span>
              <input aria-label="Connection thickness" className="line-thickness" type="range" min="1" max="5" step="0.2" value={selectedEdges[0]?.thickness ?? 1.8} onChange={(event) => updateSelectedEdges({ thickness: Number(event.target.value) })} />
              <span>Effect</span>
              <div className="effect-picker">
                {(["pulse", "trail", "glow", "dash", "signal"] as EdgeEffect[]).map((effect) => <button aria-label={`${effect} connection effect`} className={selectedEdges.every((edge) => edge.effect === effect) ? "active" : ""} key={effect} onClick={() => updateSelectedEdges({ effect, animated: true })}>{effect}</button>)}
              </div>
              <span>Speed · {(selectedEdges[0]?.speed ?? 2.1).toFixed(1)} s</span>
              <input aria-label="Connection animation speed" className="line-thickness" type="range" min="0.4" max="6" step="0.1" value={selectedEdges[0]?.speed ?? 2.1} onChange={(event) => updateSelectedEdges({ speed: Number(event.target.value) })} />
              <label className="toggle-row"><input aria-label="Animate connection" type="checkbox" checked={selectedEdges.every((edge) => edge.animated)} onChange={(event) => updateSelectedEdges({ animated: event.target.checked })} /><span>Animated flow</span></label>
              <button className="delete-selection" onClick={() => canvasRef.current?.deleteSelection([], selectedEdgeIds)}>Delete connection</button>
            </section>
          ) : selectedNodes.length ? (
            <section className="selection-editor">
              {/* Three tabs instead of one 2,007 px scroll. Nothing was removed;
                  each pane now fits the panel. */}
              <div className="inspector-tabs" role="tablist">
                {(["content", "style", "layout"] as const).map((tab) => (
                  <button aria-selected={inspectorTab === tab} className={inspectorTab === tab ? "active" : ""} key={tab} onClick={() => setInspectorTab(tab)} role="tab" type="button">{tab}</button>
                ))}
              </div>
              <div className="inspector-pane" hidden={inspectorTab !== "content"}>
              <label>SELECTED · {selectedNodes.length}</label>
              {selectedNodes.length > 1 ? <div className="multi-selection-actions"><p>Style changes apply to all {selectedNodes.length} selected components.</p><div><button onClick={() => canvasRef.current?.groupSelection(selectedNodeIds)}>Group</button><button onClick={() => canvasRef.current?.ungroupSelection(selectedNodeIds)}>Ungroup</button></div></div> : null}
              {selectedNodes.length === 1 ? <>
                <span>Name</span>
                <input aria-label="Component name" value={selectedNodes[0].label} onChange={(event) => updateSelected({ label: event.target.value })} />
                <span>Description</span>
                <input aria-label="Component description" value={selectedNodes[0].detail ?? ""} onChange={(event) => updateSelected({ detail: event.target.value })} />
                <span>Caption below</span>
                <input aria-label="Component caption" placeholder="Optional supporting caption" value={selectedNodes[0].caption ?? ""} onChange={(event) => updateSelected({ caption: event.target.value })} />
                <span>Note</span>
                <input aria-label="Component note" placeholder="Optional implementation note" value={selectedNodes[0].note ?? ""} onChange={(event) => updateSelected({ note: event.target.value })} />
              </> : <p>Changes apply to all selected items.</p>}
              <span>Type</span>
              <select aria-label="Component type" value={selectedNodes.length === 1 ? selectedNodes[0].role : ""} onChange={(event) => updateSelected({ role: event.target.value as NodeRole })}>
                {selectedNodes.length > 1 ? <option value="" disabled>Choose type</option> : null}
                {Object.keys(roleColors).map((role) => <option key={role} value={role}>{role}</option>)}
              </select>
              <span>Technology icon</span>
              <IconPicker
                matches={(technology) => technology === undefined
                  ? selectedNodes.every((node) => !node.technology)
                  : selectedNodes.every((node) => node.technology === technology)}
                onSelect={(technology) => updateSelected({ technology })}
              />
              </div>
              <div className="inspector-pane" hidden={inspectorTab !== "style"}>
              <span>Color</span>
              <div className="color-editor">
                {colorPresets.map((color) => <button aria-label={`Set color ${color}`} className={selectedNodes.every((node) => node.color.toLowerCase() === color) ? "active" : ""} key={color} onClick={() => updateSelected({ color })} style={{ "--swatch": color } as React.CSSProperties} />)}
                <label title="Custom color"><input aria-label="Custom component color" type="color" value={selectedNodes[0].color} onChange={(event) => updateSelected({ color: event.target.value })} /><i /></label>
              </div>
              <span>Typography</span>
              <div className="typography-editor">
                <select aria-label="Component font family" value={selectedNodes.every((node) => (node.fontFamily ?? "geist-mono") === (selectedNodes[0].fontFamily ?? "geist-mono")) ? selectedNodes[0].fontFamily ?? "geist-mono" : ""} onChange={(event) => updateSelected({ fontFamily: event.target.value as NodeFontFamily })}>
                  {selectedNodes.length > 1 ? <option value="" disabled>Choose font</option> : null}
                  {fontOptions.map((font) => <option key={font.value} value={font.value}>{font.label}</option>)}
                </select>
                <select aria-label="Component font weight" value={selectedNodes.every((node) => (node.fontWeight ?? 700) === (selectedNodes[0].fontWeight ?? 700)) ? selectedNodes[0].fontWeight ?? 700 : ""} onChange={(event) => updateSelected({ fontWeight: Number(event.target.value) as NodeFontWeight })}>
                  {selectedNodes.length > 1 ? <option value="" disabled>Weight</option> : null}
                  <option value="400">Regular</option><option value="500">Medium</option><option value="600">Semibold</option><option value="700">Bold</option>
                </select>
              </div>
              <span>Font size · {Math.round(selectedNodes[0]?.fontSize ?? 14)} px</span>
              <input aria-label="Component font size" className="line-thickness" type="range" min="8" max="32" step="1" value={selectedNodes[0]?.fontSize ?? 14} onChange={(event) => updateSelected({ fontSize: Number(event.target.value) })} />
              <span>Text alignment</span>
              <div className="text-align-picker">
                {(["left", "center", "right"] as NodeTextAlign[]).map((alignment) => <button aria-label={`Align component text ${alignment}`} className={selectedNodes.every((node) => (node.textAlign ?? "left") === alignment) ? "active" : ""} key={alignment} onClick={() => updateSelected({ textAlign: alignment })}>{alignment}</button>)}
              </div>
              <span>Text color</span>
              <div className="color-editor">
                {textColorPresets.map((color) => <button aria-label={`Set text color ${color}`} className={selectedNodes.every((node) => (node.textColor ?? "#f5f5f5").toLowerCase() === color) ? "active" : ""} key={color} onClick={() => updateSelected({ textColor: color })} style={{ "--swatch": color } as React.CSSProperties} />)}
                <label title="Custom text color"><input aria-label="Custom component text color" type="color" value={selectedNodes[0].textColor ?? "#f5f5f5"} onChange={(event) => updateSelected({ textColor: event.target.value })} /><i /></label>
              </div>
              <span>Border style</span>
              <div className="line-style-picker">
                {(["solid", "dashed", "dotted"] as EdgeStrokeStyle[]).map((style) => <button aria-label={`${style} component border`} className={selectedNodes.every((node) => node.borderStyle === style) ? "active" : ""} key={style} onClick={() => updateSelected({ borderStyle: style })}><i className={style} />{style}</button>)}
              </div>
              <span>Border · {(selectedNodes[0]?.borderWidth ?? 1).toFixed(1)} px</span>
              <input aria-label="Component border width" className="line-thickness" type="range" min="1" max="4" step="0.2" value={selectedNodes[0]?.borderWidth ?? 1} onChange={(event) => updateSelected({ borderWidth: Number(event.target.value) })} />
              <span>Size · {Math.round(selectedNodes[0]?.size.width ?? 220)} × {Math.round(selectedNodes[0]?.size.height ?? 104)}</span>
              <div className="size-editor">
                <label>W<input aria-label="Component width" type="number" min={structureRoles.has(selectedNodes[0]?.role) ? 280 : 140} max={structureRoles.has(selectedNodes[0]?.role) ? 1400 : 440} value={Math.round(selectedNodes[0]?.size.width ?? 220)} onChange={(event) => updateSelected({ size: { width: numberFieldValue(event.target.value, selectedNodes[0]?.size.width ?? 220, structureRoles.has(selectedNodes[0]?.role) ? 280 : 140, structureRoles.has(selectedNodes[0]?.role) ? 1400 : 440), height: selectedNodes[0]?.size.height ?? 104 } })} /></label>
                <label>H<input aria-label="Component height" type="number" min={structureRoles.has(selectedNodes[0]?.role) ? 160 : 72} max={structureRoles.has(selectedNodes[0]?.role) ? 900 : 260} value={Math.round(selectedNodes[0]?.size.height ?? 104)} onChange={(event) => updateSelected({ size: { width: selectedNodes[0]?.size.width ?? 220, height: numberFieldValue(event.target.value, selectedNodes[0]?.size.height ?? 104, structureRoles.has(selectedNodes[0]?.role) ? 160 : 72, structureRoles.has(selectedNodes[0]?.role) ? 900 : 260) } })} /></label>
              </div>
              <span>Effect</span>
              <div className="effect-picker effect-picker--node">
                {(["none", "pulse", "trail", "glow", "scan", "breathe"] as NodeEffect[]).map((effect) => <button aria-label={`${effect} component effect`} className={selectedNodes.every((node) => node.effect === effect) ? "active" : ""} key={effect} onClick={() => updateSelected({ effect })}>{effect}</button>)}
              </div>
              <span>Effect speed · {(selectedNodes[0]?.speed ?? 2.1).toFixed(1)} s</span>
              <input aria-label="Component effect speed" className="line-thickness" disabled={selectedNodes.every((node) => node.effect === "none")} type="range" min="0.4" max="6" step="0.1" value={selectedNodes[0]?.speed ?? 2.1} onChange={(event) => updateSelected({ speed: Number(event.target.value) })} />
              </div>
              <div className="inspector-pane" hidden={inspectorTab !== "layout"}>
              <span>Background image</span>
              <input aria-label="Component background image URL" disabled={selectedNodes.length === 1 && Boolean(assetIdOf(selectedNodes[0].backgroundImage))} placeholder="https://…" value={selectedNodes.length !== 1 ? "" : assetIdOf(selectedNodes[0].backgroundImage) ? "Uploaded image" : selectedNodes[0].backgroundImage ?? ""} onChange={(event) => updateSelected({ backgroundImage: event.target.value })} />
              <div className="background-editor">
                <label>Upload<input accept="image/*" aria-label="Upload component background image" type="file" onChange={(event) => { const file = event.target.files?.[0]; event.currentTarget.value = ""; if (file) void setBackgroundImage(file); }} /></label>
                <select aria-label="Component background fit" value={selectedNodes[0]?.backgroundFit ?? "cover"} onChange={(event) => updateSelected({ backgroundFit: event.target.value as "cover" | "contain" })}><option value="cover">Cover</option><option value="contain">Contain</option></select>
                <button disabled={selectedNodes.every((node) => !node.backgroundImage)} onClick={() => updateSelected({ backgroundImage: "" })}>Remove</button>
              </div>
              <span>Background opacity · {Math.round((selectedNodes[0]?.backgroundOpacity ?? 0.28) * 100)}%</span>
              <input aria-label="Component background opacity" className="line-thickness" disabled={selectedNodes.every((node) => !node.backgroundImage)} type="range" min="0" max="1" step="0.05" value={selectedNodes[0]?.backgroundOpacity ?? 0.28} onChange={(event) => updateSelected({ backgroundOpacity: Number(event.target.value) })} />
              <span>Layer · z {selectedNodes[0]?.zIndex ?? 1}</span>
              <div className="z-index-editor"><button onClick={() => updateSelected({ zIndex: Math.max(-20, (selectedNodes[0]?.zIndex ?? 1) - 1) })}>Send back</button><input aria-label="Component z-index" type="number" min="-20" max="100" value={selectedNodes[0]?.zIndex ?? 1} onChange={(event) => updateSelected({ zIndex: numberFieldValue(event.target.value, selectedNodes[0]?.zIndex ?? 1, -20, 100) })} /><button onClick={() => updateSelected({ zIndex: Math.min(100, (selectedNodes[0]?.zIndex ?? 1) + 1) })}>Bring front</button></div>
              </div>
              <button className="delete-selection" onClick={() => canvasRef.current?.deleteSelection(selectedNodeIds, [])}>Delete component{selectedNodeIds.length > 1 ? "s" : ""}</button>
            </section>
          ) : <section className="selection-empty"><label>SELECTION</label><p>Select components or connections to edit their visual and technical properties.</p></section>}
          <ItemCommentThread workspaceId={document.id} nodeIds={selectedNodeIds} edgeIds={selectedEdgeIds} />
          <section><label>FORMAT</label><div className="segmented segmented--formats">{(["full", "16:9", "1:1", "4:5", "9:16"] as DiagramFormat[]).map((format) => <button aria-label={`Set format ${format}`} className={(document.format ?? "16:9") === format ? "active" : ""} key={format} onClick={() => setDocumentFormat(format)}>{format === "full" ? "Full" : format}</button>)}</div></section>
          <section><label>DIAGRAM</label><dl><div><dt>Mode</dt><dd>{document.mode}</dd></div><div><dt>Grid</dt><dd>8 px</dd></div><div><dt>Routing</dt><dd>Orthogonal</dd></div><div><dt>Storage</dt><dd className="enabled">{session ? "Local + cloud" : "Local"}</dd></div></dl></section>
          <section className="quality"><label>QUALITY CHECKS</label><p><i /> Named ports</p><p><i /> Snap-to-grid</p><p><i /> Typed AI plan</p></section>
        </aside>
      </section>
      {presenting ? (
        <div aria-label="Presentation controls" className="present-bar" role="group">
          <button aria-label="Previous scene" disabled={activeSceneIndex === 0} onClick={() => goToScene(activeSceneIndex - 1)}>‹</button>
          <b>{scenes[activeSceneIndex]?.name ?? document.title}</b>
          <span>{activeSceneIndex + 1} / {scenes.length}</span>
          <button aria-label="Next scene" disabled={activeSceneIndex >= scenes.length - 1} onClick={() => goToScene(activeSceneIndex + 1)}>›</button>
          <i />
          <button className="present-exit" onClick={stopPresenting}>Exit <kbd>Esc</kbd></button>
        </div>
      ) : null}
      <AiConnectionSettings open={configOpen} onClose={() => setConfigOpen(false)} />
      <AccountDialog
        onClose={() => setAccountOpen(false)}
        onCreateAccount={createAccount}
        onSignIn={signIn}
        onSignOut={signOut}
        onSyncNow={syncNow}
        open={accountOpen}
        session={session}
        state={syncState}
      />
      <ConflictDialog conflict={syncConflict} onResolve={resolveConflict} />
      <HistoryDialog
        currentVersion={versionOf(document.id)}
        onClose={() => setHistoryOpen(false)}
        onRestore={(version) => restoreTo(document.id, version)}
        open={historyOpen}
        projectId={projectIdFor(document.id)}
      />
    </main>
    </AiAssistantProvider>
  );
}
