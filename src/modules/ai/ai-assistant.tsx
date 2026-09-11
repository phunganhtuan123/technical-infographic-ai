"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ZodError } from "zod";
import type { DiagramDocument } from "@/modules/diagram/schema";
import { buildProposalDocument, createProposalRevealFrames, decorateProposalDocument, proposalChangeCounts, validateProposal } from "./proposal-engine";
import { sceneFingerprint, scopedDiagramContext } from "./context";
import { rememberGatewayOrigin } from "@/modules/projects/user-settings";
import { DirectGatewayConnector, MockGatewayConnector, clearClientGatewayUrl, discoverCapabilities, discoverClientGateway, saveClientGatewayUrl, savePendingModel, savePendingProvider, savePendingProviderKey, savedClientGatewayUrl, takePendingModel, takePendingProvider, takePendingProviderKey, type AiConnector, type AiProgress } from "./gateway";
import { completePkceAuthorization, beginPkceAuthorization } from "./pkce";
import { sanitizeDiagramImage } from "./image-input";
import { bestFitFormat } from "@/modules/diagram/bounds";
import { BUBBLE_SIZE, bubbleWidth, panelPlacement, useChatBubble } from "./chat-bubble";
import { createSession, createThread, deleteThread, listSessions, loadThread, saveThread, sessionTitle, threadContext, updateThreadProposalStatus, type AiThread } from "./thread-store";
import { BrowserKeyConnector, activeDirectProvider, clearDirectKey, saveDirectKey, savedDirectKey, validateDirectKey, type DirectProviderId } from "./direct-providers";
import type { AiIntent, AiProvider, DiagramProposal } from "./contracts";

type ProposalState = { proposal: DiagramProposal; document: DiagramDocument; fingerprint: string; targetNodeIds: string[]; targetEdgeIds: string[]; stale: boolean; building: boolean; buildProgress?: string };
type AiActivity = { startedAt: number; phase: "received" | "generating" | "validating" | "repairing" | "building"; detail: string };
type AiSendInput = { prompt: string; intent: AiIntent; mode?: string; format?: string; image?: { mimeType: "image/png" | "image/jpeg" | "image/webp"; dataUrl: string }; thread?: AiThread };
type AssistantContextValue = {
  connected: boolean;
  busy: boolean;
  status: string;
  activity?: AiActivity;
  providers: AiProvider[];
  providerId: "auto" | AiProvider["id"];
  model: string;
  gatewayOrigin?: string;
  proposal?: ProposalState;
  session?: AiThread;
  connect(gatewayUrl: string, preferredProvider?: string, preferredModel?: string, providerKey?: string): Promise<void>;
  disconnect(): void;
  forgetGateway(): void;
  cancel(): void;
  reject(): void;
  addProviderKey(provider: "gemini", apiKey: string): Promise<void>;
  connectWithKey(provider: DirectProviderId, apiKey: string, preferredModel?: string): Promise<void>;
  selectProvider(providerId: "auto" | AiProvider["id"]): void;
  selectModel(model: string): void;
  accept(): Promise<void>;
  send(input: AiSendInput): Promise<DiagramProposal | undefined>;
  sendSession(input: Omit<AiSendInput, "thread">): Promise<DiagramProposal | undefined>;
  clearSession(): void;
  sessions: AiThread[];
  openSession(id: string): void;
  removeSession(id: string): void;
};

const AssistantContext = createContext<AssistantContextValue | null>(null);

function readableAiError(error: unknown) {
  if (error instanceof ZodError) {
    const first = error.issues[0];
    const location = first?.path.length ? ` at ${first.path.join(".")}` : "";
    return `AI returned an incompatible diagram${location}. The response was rejected safely.`;
  }
  return error instanceof Error ? error.message.slice(0, 240) : "AI request failed";
}

function activityForProgress(progress: AiProgress): Pick<AiActivity, "phase" | "detail"> {
  if (progress === "Validating proposal") return { phase: "validating", detail: "Checking nodes, paths, and diagram structure" };
  if (progress === "Building preview") return { phase: "building", detail: "Drawing the proposal on the canvas" };
  return { phase: "generating", detail: progress === "Understanding input" ? "Reading your request and current chart context" : progress };
}

function acceptedPreview(document: DiagramDocument) {
  return {
    ...document,
    nodes: document.nodes.filter((node) => node.previewStatus !== "deleted").map(({ previewStatus: _, ...node }) => node),
    edges: document.edges.filter((edge) => edge.previewStatus !== "deleted").map(({ previewStatus: _, ...edge }) => edge),
  };
}

export function useAiAssistant() {
  const value = useContext(AssistantContext);
  if (!value) throw new Error("AI assistant is unavailable");
  return value;
}

export function AiAssistantProvider({ children, document, revision, selectedNodeIds, selectedEdgeIds, onAccept }: {
  children: ReactNode;
  document: DiagramDocument;
  revision: number;
  selectedNodeIds: string[];
  selectedEdgeIds: string[];
  onAccept(next: DiagramDocument, intent: AiIntent, proposal: DiagramProposal): void;
}) {
  const [connector, setConnector] = useState<AiConnector>();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("AI disconnected");
  const [activity, setActivity] = useState<AiActivity>();
  const [providerId, setProviderId] = useState<"auto" | AiProvider["id"]>("auto");
  // The connector mutates its own provider list when a key is added, which React
  // cannot see. Bumping this is what republishes the context value.
  const [providersRevision, setProvidersRevision] = useState(0);
  const [model, setModel] = useState("");
  const [gatewayOrigin, setGatewayOrigin] = useState<string>();
  const [proposal, setProposal] = useState<ProposalState>();
  const [session, setSession] = useState<AiThread>();
  const controllerRef = useRef<AbortController | undefined>(undefined);
  const requestFailureRef = useRef<string | undefined>(undefined);
  const [sessions, setSessions] = useState<AiThread[]>([]);
  const documentRef = useRef(document);
  documentRef.current = document;

  useEffect(() => {
    let active = true;
    setProposal(undefined);
    // Every past conversation for this workspace, newest first. The one that
    // opens is the newest; the rest stay available in the session list.
    void (async () => {
      const stored = await listSessions(document.id);
      // Conversations saved before sessions were separate live under the old
      // single id; fold that one in so nothing is orphaned.
      const legacy = await loadThread(document.id, ["workspace"]);
      const all = legacy && !stored.some((thread) => thread.id === legacy.id) ? [legacy, ...stored] : stored;
      if (!active) return;
      setSessions(all);
      setSession(all[0] ?? createSession(document.id));
    })();
    return () => { active = false; };
  }, [document.id]);

  // The list is what the session picker renders, so the open conversation has to
  // keep its entry in sync as it grows — otherwise its label and timestamp are
  // whatever they were when it was opened.
  useEffect(() => {
    if (!session) return;
    setSessions((current) => {
      const index = current.findIndex((thread) => thread.id === session.id);
      if (index === -1) return [session, ...current];
      if (current[index] === session) return current;
      const next = [...current];
      next[index] = session;
      return next;
    });
  }, [session]);

  useEffect(() => {
    if (!proposal) return;
    const fingerprint = sceneFingerprint(document, proposal.targetNodeIds, proposal.targetEdgeIds);
    if (fingerprint !== proposal.fingerprint) setProposal((current) => current ? { ...current, stale: true } : current);
  }, [document, proposal?.fingerprint, revision]);

  useEffect(() => {
    if (process.env.NEXT_PUBLIC_AI_GATEWAY_MOCK === "true") { setStatus("Development AI available"); return; }
    // A key that is already in this browser needs no pairing and no round trip,
    // so restoring it first keeps the common case free of any setup at all.
    const directProvider = activeDirectProvider();
    const directKey = directProvider ? savedDirectKey(directProvider) : undefined;
    if (directProvider && directKey && !new URLSearchParams(window.location.search).has("code")) {
      void validateDirectKey(directProvider, directKey)
        .then((models) => {
          const live = new BrowserKeyConnector(directProvider, directKey, models);
          setConnector(live);
          setGatewayOrigin("browser-direct");
          setProviderId(live.providers[0].id);
          setModel(live.providers[0].defaultModel);
          setStatus(`${live.providers[0].label} connected`);
        })
        .catch(() => setStatus("Saved key no longer works — reconnect in Config"));
      return;
    }
    const saved = savedClientGatewayUrl();
    if (!saved) { setStatus("Connect your Client AI Gateway"); return; }
    setGatewayOrigin(saved);
    const callback = new URLSearchParams(window.location.search).has("code");
    if (!callback) { setStatus("Client AI Gateway ready to connect"); return; }
    void discoverClientGateway(saved).then(async ({ metadata: nextMetadata }) => {
      const token = await completePkceAuthorization();
      if (!token) throw new Error("Client AI authorization callback is incomplete");
      const discovered = await discoverCapabilities(nextMetadata, token);
      const live = new DirectGatewayConnector(nextMetadata, token, discovered);
      const preferredProvider = takePendingProvider();
      const preferredModel = takePendingModel();
      // A key typed before pairing only reaches the connector now, once there is
      // a token to send it with. Doing it before the provider is selected keeps
      // the picker from briefly showing a provider that is not usable yet.
      const providerKey = takePendingProviderKey();
      if (providerKey && preferredProvider === "gemini") {
        try { await live.setProviderKey("gemini", providerKey); }
        catch (error) { setStatus(error instanceof Error ? error.message : "Could not set the Gemini key"); }
      }
      setConnector(live);
      const selectedProvider = live.providers.find((provider) => provider.id === preferredProvider);
      if (selectedProvider) {
        setProviderId(selectedProvider.id);
        setModel(preferredModel && selectedProvider.models.includes(preferredModel) ? preferredModel : selectedProvider.defaultModel);
      }
      setStatus(`${selectedProvider?.label ?? "Client AI"} connected`);
    }).catch((error) => setStatus(error instanceof Error ? error.message : "Client AI Gateway unavailable"));
  }, []);

  const connect = useCallback(async (gatewayUrl: string, preferredProvider?: string, preferredModel?: string, providerKey?: string) => {
    try {
      if (process.env.NEXT_PUBLIC_AI_GATEWAY_MOCK === "true") {
        setConnector(new MockGatewayConnector());
        setGatewayOrigin("local-mock");
        setStatus("Development AI connected");
        return;
      }
      const connectionLabel = preferredProvider === "local" ? "Infographic AI" : preferredProvider === "gemini" ? "Gemini" : preferredProvider === "codex" ? "Codex" : preferredProvider === "anthropic" ? "Claude" : "Organization Gateway";
      setStatus(`Discovering ${connectionLabel}`);
      const discoveredGateway = await discoverClientGateway(gatewayUrl);
      const nextMetadata = discoveredGateway.metadata;
      setGatewayOrigin(discoveredGateway.origin);
      const origin = new URL(nextMetadata.apiBaseUrl!).origin;
      const consentKey = `technical-infographic-ai-consent:${nextMetadata.organizationId}:${origin}:${nextMetadata.policyVersion}`;
      if (!localStorage.getItem(consentKey)) {
        const destination = preferredProvider ? `${connectionLabel} on this machine` : "your organization's AI Gateway";
        const accepted = window.confirm(`Technical Infographic sends your prompt, attached image and scoped diagram context directly to ${destination}. The application server does not receive that content. Continue?`);
        if (!accepted) { setStatus("Client AI connection cancelled"); return; }
        localStorage.setItem(consentKey, new Date().toISOString());
      }
      saveClientGatewayUrl(discoveredGateway.origin);
      // …and to the account, so a second machine does not ask for it again.
      void rememberGatewayOrigin(discoveredGateway.origin);
      savePendingProvider(preferredProvider);
      savePendingModel(preferredModel);
      savePendingProviderKey(providerKey);
      await beginPkceAuthorization(nextMetadata);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Client AI Gateway unavailable");
      throw error;
    }
  }, []);

  const connectWithKey = useCallback(async (provider: DirectProviderId, apiKey: string, preferredModel?: string) => {
    setStatus("Checking key");
    try {
      // Validating by listing models does double duty: it rejects a bad key at
      // the point it was pasted, and the list it returns is the model picker.
      const models = await validateDirectKey(provider, apiKey);
      const live = new BrowserKeyConnector(provider, apiKey, models);
      saveDirectKey(provider, apiKey);
      setConnector(live);
      setGatewayOrigin("browser-direct");
      setProviderId(live.providers[0].id);
      setModel(preferredModel && models.includes(preferredModel) ? preferredModel : live.providers[0].defaultModel);
      setStatus(`${live.providers[0].label} connected`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not use that key");
      throw error;
    }
  }, []);

  // Adding a key to a connection that already exists: no redirect needed, the
  // connector re-discovers its backends and the picker refreshes in place.
  const addProviderKey = useCallback(async (provider: "gemini", apiKey: string) => {
    if (!(connector instanceof DirectGatewayConnector)) { setStatus("Connect the local connector before adding a key"); return; }
    try {
      const providers = await connector.setProviderKey(provider, apiKey);
      const added = providers.find((entry) => entry.id === provider);
      if (added) { setProviderId(added.id); setModel(added.defaultModel); }
      setProvidersRevision((value) => value + 1);
      setStatus(added ? `${added.label} connected` : "Key saved");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not save the key");
    }
  }, [connector]);

  const disconnect = useCallback(() => {
    controllerRef.current?.abort();
    setConnector(undefined);
    setProposal(undefined);
    setBusy(false);
    setActivity(undefined);
    setStatus("AI disconnected");
  }, []);

  const forgetGateway = useCallback(() => {
    disconnect();
    const directProvider = activeDirectProvider();
    if (directProvider) clearDirectKey(directProvider);
    clearClientGatewayUrl();
    setGatewayOrigin(undefined);
    setProviderId("auto");
    setModel("");
    setStatus("Connect your Client AI Gateway");
  }, [disconnect]);

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
    requestFailureRef.current = "Request stopped. Your prompt remains in this session.";
    setProposal(undefined);
    setBusy(false);
    setActivity(undefined);
    setStatus("Request cancelled · draft preserved");
  }, []);

  const send = useCallback(async ({ prompt, intent, mode = "auto", format = "auto", image, thread }: AiSendInput) => {
    if (!connector) { setStatus("Connect AI before sending"); return undefined; }
    if (!connector.capabilities.has("structured_output")) { setStatus("Gateway does not support structured output"); return undefined; }
    if (intent === "modify-selection" && !connector.capabilities.has("diagram_patch")) { setStatus("Gateway does not support scoped diagram patches"); return undefined; }
    if (intent !== "modify-selection" && !connector.capabilities.has("diagram_plan")) { setStatus("Gateway does not support diagram plans"); return undefined; }
    if (image && !connector.capabilities.has("vision")) { setStatus("Gateway does not support image input"); return undefined; }
    const workingDocument = proposal ? acceptedPreview(proposal.document) : documentRef.current;
    const targetNodes = intent === "modify-selection" ? selectedNodeIds : [];
    const targetEdges = intent === "modify-selection" ? selectedEdgeIds : [];
    const fingerprint = sceneFingerprint(documentRef.current, targetNodes, targetEdges);
    const controller = new AbortController();
    controllerRef.current = controller;
    requestFailureRef.current = undefined;
    setBusy(true);
    setActivity({ startedAt: Date.now(), phase: "received", detail: "Prompt received and queued for the selected AI" });
    setProposal((current) => current ? { ...current, building: true, buildProgress: "AI is revising the current preview" } : current);
    setStatus("Connecting");
    try {
      const request = {
        requestId: `request-${crypto.randomUUID()}`, prompt, intent,
        mode: mode as never, format: format as never,
        document: scopedDiagramContext(workingDocument, targetNodes, targetEdges),
        selectedNodeIds: targetNodes, selectedEdgeIds: targetEdges,
        threadSummary: thread ? threadContext(thread) : undefined, image, providerId,
        model: providerId === "auto" ? undefined : model || connector.providers.find((provider) => provider.id === providerId)?.defaultModel,
      };
      let raw: DiagramProposal;
      try {
        raw = await connector.generate(request, controller.signal, (progress: AiProgress) => {
          setStatus(progress);
          setActivity((current) => ({ startedAt: current?.startedAt ?? Date.now(), ...activityForProgress(progress) }));
        });
        raw = validateProposal(raw, workingDocument, { intent, nodeIds: targetNodes, edgeIds: targetEdges });
      } catch (firstError) {
        if (controller.signal.aborted) throw firstError;
        setStatus("Repairing invalid proposal");
        setActivity((current) => ({ startedAt: current?.startedAt ?? Date.now(), phase: "repairing", detail: "AI returned an invalid structure; requesting a corrected chart" }));
        raw = await connector.generate({ ...request, prompt: `${prompt}\n\nRepair the previous response. Validation error: ${firstError instanceof Error ? firstError.message : "invalid schema"}` }, controller.signal, (progress) => {
          setStatus(progress);
          if (progress !== "Understanding input") setActivity((current) => ({ startedAt: current?.startedAt ?? Date.now(), ...activityForProgress(progress) }));
        });
        raw = validateProposal(raw, workingDocument, { intent, nodeIds: targetNodes, edgeIds: targetEdges });
      }
      if (raw.patches.some((patch) => patch.op.startsWith("delete")) && !/\b(delete|remove)\b|\b(xóa|xoá)\b/i.test(prompt)) throw new Error("AI deletion requires an explicit delete instruction");
      setStatus("Building preview");
      setActivity((current) => ({ startedAt: current?.startedAt ?? Date.now(), phase: "building", detail: "Drawing nodes and paths on the canvas" }));
      const requestedFormat = format === "auto" ? workingDocument.format : format as DiagramDocument["format"];
      const baseDocument = { ...workingDocument, format: requestedFormat };
      const built = await buildProposalDocument(baseDocument, raw);
      // "Auto" means the frame follows the drawing. Left as the workspace
      // default, a tall flowchart was fitted to 16:9 by widening the canvas
      // until the diagram was a ribbon down the middle of it.
      const appliedDocument = format === "auto"
        ? { ...built, format: bestFitFormat(built) }
        : built;
      const previewDocument = decorateProposalDocument(workingDocument, appliedDocument, raw);
      const frames = createProposalRevealFrames(previewDocument);
      const activeNodeTotal = previewDocument.nodes.filter((node) => node.previewStatus !== "deleted").length;
      const activeEdgeTotal = previewDocument.edges.filter((edge) => edge.previewStatus !== "deleted").length;
      for (let index = 0; index < frames.length; index += 1) {
        if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
        const frame = frames[index];
        const nodeCount = frame.nodes.filter((node) => node.previewStatus !== "deleted").length;
        const edgeCount = frame.edges.filter((edge) => edge.previewStatus !== "deleted").length;
        const building = index < frames.length - 1;
        const buildProgress = `${nodeCount}/${activeNodeTotal} nodes · ${edgeCount}/${activeEdgeTotal} paths`;
        setProposal({ proposal: raw, document: frame, fingerprint, targetNodeIds: targetNodes, targetEdgeIds: targetEdges, stale: false, building, buildProgress });
        if (building) {
          setStatus(`Live build · ${buildProgress}`);
          await new Promise((resolve) => setTimeout(resolve, 180));
        }
      }
      setStatus("Proposal ready · review before accepting");
      return raw;
    } catch (error) {
      if ((error as DOMException).name !== "AbortError") {
        const message = readableAiError(error);
        requestFailureRef.current = `Request failed: ${message}`;
        setStatus(message);
        if (proposal) setProposal({ ...proposal, building: false });
      }
      return undefined;
    } finally { setBusy(false); setActivity(undefined); }
  }, [connector, model, proposal, providerId, selectedEdgeIds, selectedNodeIds]);

  const sendSession = useCallback(async (input: Omit<AiSendInput, "thread">) => {
    const current = session ?? createThread(documentRef.current.id, ["workspace"], "workspace");
    const createdAt = new Date().toISOString();
    const next: AiThread = {
      ...current,
      entries: [
        ...current.entries.map((entry) => entry.proposalStatus === "pending" ? { ...entry, proposalStatus: "superseded" as const } : entry),
        { id: crypto.randomUUID(), role: "user", body: input.prompt, createdAt },
      ],
      updatedAt: createdAt,
    };
    setSession(next);
    const resultPromise = send({ ...input, thread: next });
    await saveThread(next);
    const result = await resultPromise;
    if (!result) {
      const failed: AiThread = {
        ...next,
        entries: [...next.entries, { id: crypto.randomUUID(), role: "assistant", body: requestFailureRef.current ?? "The AI request ended before a proposal was created.", createdAt: new Date().toISOString() }],
        updatedAt: new Date().toISOString(),
      };
      setSession(failed);
      await saveThread(failed);
      return undefined;
    }
    const updated: AiThread = {
      ...next,
      summary: result.threadSummary,
      entries: [...next.entries, { id: crypto.randomUUID(), role: "assistant", body: result.explanation || result.summary, createdAt: new Date().toISOString(), proposalId: result.id, proposalStatus: "pending" }],
      updatedAt: new Date().toISOString(),
    };
    setSession(updated);
    await saveThread(updated);
    return result;
  }, [send, session]);

  const clearSession = useCallback(() => {
    // A new conversation is a new record. The previous one keeps its own id and
    // stays in the list, which is what makes it readable again later.
    const next = createSession(documentRef.current.id);
    setSession(next);
    setSessions((current) => [next, ...current]);
    setProposal(undefined);
    void saveThread(next);
    setStatus("New AI session started");
  }, []);

  const openSession = useCallback((id: string) => {
    setSessions((current) => {
      const found = current.find((thread) => thread.id === id);
      if (found) { setSession(found); setProposal(undefined); }
      return current;
    });
  }, []);

  const removeSession = useCallback((id: string) => {
    void deleteThread(id);
    setSessions((current) => {
      const left = current.filter((thread) => thread.id !== id);
      setSession((active) => active?.id === id ? left[0] ?? createSession(documentRef.current.id) : active);
      return left;
    });
  }, []);

  const accept = useCallback(async () => {
    if (!proposal || proposal.stale || proposal.building) return;
    const deletes = proposal.proposal.patches.filter((patch) => patch.op.startsWith("delete"));
    // Accepting replaces the scene at the workspace level, past the canvas
    // undo history — so this really is the last chance to say no.
    if (deletes.length && !window.confirm(`Accept this proposal? It deletes ${deletes.length} item${deletes.length === 1 ? "" : "s"} and cannot be undone.`)) return;
    const acceptedDocument = acceptedPreview(proposal.document);
    onAccept(acceptedDocument, proposal.proposal.intent, proposal.proposal);
    if (session) {
      const updated = updateThreadProposalStatus(session, proposal.proposal.id, "accepted");
      setSession(updated);
      void saveThread(updated);
    }
    setStatus("Proposal accepted");
    setProposal(undefined);
  }, [onAccept, proposal, session]);

  const reject = useCallback(() => {
    if (proposal && session) {
      const updated = updateThreadProposalStatus(session, proposal.proposal.id, "rejected");
      setSession(updated);
      void saveThread(updated);
    }
    setProposal(undefined);
    setStatus("Proposal rejected");
  }, [proposal, session]);

  const selectProvider = useCallback((nextProviderId: "auto" | AiProvider["id"]) => {
    setProviderId(nextProviderId);
    setModel(nextProviderId === "auto" ? "" : connector?.providers.find((provider) => provider.id === nextProviderId)?.defaultModel ?? "");
  }, [connector]);
  const value = useMemo<AssistantContextValue>(() => ({ connected: Boolean(connector), busy, status, activity, providers: connector?.providers ?? [], providerId, model, gatewayOrigin, proposal, session, connect, connectWithKey, disconnect, forgetGateway, cancel, reject, addProviderKey, selectProvider, selectModel: setModel, accept, send, sendSession, clearSession, sessions, openSession, removeSession }), [accept, activity, addProviderKey, busy, cancel, clearSession, connect, connectWithKey, connector, disconnect, forgetGateway, gatewayOrigin, model, proposal, providerId, providersRevision, reject, selectProvider, send, sendSession, session, sessions, openSession, removeSession, status]);
  return <AssistantContext.Provider value={value}>{children}</AssistantContext.Provider>;
}

export const aiSessionToggleEvent = "technical-infographic:toggle-ai-session";
export const aiSettingsOpenEvent = "technical-infographic:open-ai-settings";
const chatSeenKey = "technical-infographic:chat-seen";

/**
 * Why the send button cannot be used, in words, or undefined when it can.
 *
 * The button used to just sit there disabled. The most common reason by far is
 * that no gateway is connected yet, which is invisible from the panel — so it
 * reads as a broken button rather than a missing step.
 */
export function sendBlockedReason(connected: boolean, busy: boolean, prompt: string) {
  if (!connected) return "Connect an AI gateway first";
  if (busy) return "The AI is still working on the last request";
  if (prompt.trim().length < 2) return "Type what you want changed";
  return undefined;
}

const modes = ["auto", "architecture", "flow", "sequence", "data-pipeline", "event-driven", "agent-loop", "infrastructure", "comparison", "explainer-grid"];
const formats = ["auto", "16:9", "1:1", "4:5", "9:16", "full"];

function AiActivityMessage({ activity, onCancel }: { activity: AiActivity; onCancel(): void }) {
  const [elapsed, setElapsed] = useState(() => Math.max(0, Math.floor((Date.now() - activity.startedAt) / 1000)));
  useEffect(() => {
    const update = () => setElapsed(Math.max(0, Math.floor((Date.now() - activity.startedAt) / 1000)));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [activity.startedAt]);
  const phases: AiActivity["phase"][] = ["received", "generating", "validating", "building"];
  const activeIndex = activity.phase === "repairing" ? 2 : phases.indexOf(activity.phase);
  const labels = ["Received", "Generate", activity.phase === "repairing" ? "Repair" : "Validate", "Draw"];
  return <article aria-live="polite" className="is-assistant is-working">
    <div><b>AI is working</b><i>{elapsed}s</i></div>
    <p>{activity.detail}</p>
    <ol aria-label="AI request progress">{labels.map((label, index) => <li className={index < activeIndex ? "is-done" : index === activeIndex ? "is-active" : ""} key={label}><i />{label}</li>)}</ol>
    {elapsed >= 12 && activity.phase === "generating" ? <small>The model is still generating the structured diagram. You can stop without losing your prompt.</small> : null}
    <button onClick={onCancel}>Stop request</button>
  </article>;
}

export function GlobalAiComposer({ hasNodes, currentFormat }: { hasNodes: boolean; currentFormat: string }) {
  const ai = useAiAssistant();
  const [prompt, setPrompt] = useState("");
  const [intent, setIntent] = useState<AiIntent>(hasNodes ? "modify-current" : "new-scene");
  const [mode, setMode] = useState("auto");
  const [format, setFormat] = useState(currentFormat);
  const [intentLocked, setIntentLocked] = useState(false);
  const [image, setImage] = useState<{ mimeType: "image/png"; dataUrl: string; width: number; height: number }>();
  const [clarificationOpen, setClarificationOpen] = useState(false);
  const [objective, setObjective] = useState("Show the main flow, decisions, and failure paths clearly");
  const [audience, setAudience] = useState("engineers");
  const [detailLevel, setDetailLevel] = useState("balanced");
  const [mustInclude, setMustInclude] = useState("");
  const [sessionOpen, setSessionOpen] = useState(false);

  useEffect(() => {
    const toggle = () => setSessionOpen((value) => !value);
    window.addEventListener(aiSessionToggleEvent, toggle);
    return () => window.removeEventListener(aiSessionToggleEvent, toggle);
  }, []);

  // The launcher nudges for attention until it has been opened once. After
  // that it stays put: a control that keeps pulsing at someone who already
  // knows what it is stops being a hint and becomes noise.
  const [everOpened, setEverOpened] = useState(true);
  useEffect(() => {
    try { setEverOpened(window.localStorage.getItem(chatSeenKey) === "1"); } catch { setEverOpened(true); }
  }, []);
  const launcherWidth = bubbleWidth(sessionOpen);
  const bubble = useChatBubble(useCallback(() => {
    setSessionOpen((value) => {
      if (!value) {
        setEverOpened(true);
        try { window.localStorage.setItem(chatSeenKey, "1"); } catch { /* storage blocked */ }
      }
      return !value;
    });
  }, []), launcherWidth);
  const [viewport, setViewport] = useState({ width: 1600, height: 900 });
  useEffect(() => {
    const read = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    read();
    window.addEventListener("resize", read);
    return () => window.removeEventListener("resize", read);
  }, []);
  // The panel is measured rather than assumed: its height depends on how many
  // past conversations the picker is showing.
  const panelRef = useRef<HTMLElement>(null);
  const [panelHeight, setPanelHeight] = useState(480);
  useEffect(() => {
    if (!sessionOpen) return;
    const measure = () => {
      const height = panelRef.current?.offsetHeight;
      if (height) setPanelHeight(height);
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (panelRef.current) observer.observe(panelRef.current);
    return () => observer.disconnect();
  }, [sessionOpen, ai.session?.id, ai.sessions.length]);
  const placement = panelPlacement(bubble.position, viewport, panelHeight, launcherWidth);
  const fileRef = useRef<HTMLInputElement>(null);
  const sessionEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!intentLocked) setIntent(hasNodes ? "modify-current" : "new-scene"); }, [hasNodes, intentLocked]);
  useEffect(() => { if (sessionOpen) sessionEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [ai.activity?.detail, ai.session?.entries.length, sessionOpen]);
  const updatePrompt = (value: string) => {
    setPrompt(value);
    if (!intentLocked) setIntent(/\b(create|generate|visualize|recreate|new scene)\b|\b(tạo|vẽ mới)\b/i.test(value) ? "new-scene" : hasNodes ? "modify-current" : "new-scene");
  };
  const attachFile = (file?: File) => { if (file) void sanitizeDiagramImage(file).then(setImage).catch((error) => window.alert(error.message)); };
  const submit = (clarified: boolean) => {
    const requestPrompt = clarified ? [
      `Original request: ${prompt.trim()}`,
      `Primary outcome: ${objective.trim()}`,
      `Audience: ${audience}`,
      `Detail level: ${detailLevel}`,
      mustInclude.trim() ? `Must include: ${mustInclude.trim()}` : "",
      "Keep the main story readable within 5–10 seconds and use explicit success and failure paths where relevant.",
    ].filter(Boolean).join("\n") : prompt.trim();
    setClarificationOpen(false);
    setSessionOpen(true);
    setPrompt("");
    void ai.sendSession({ prompt: requestPrompt, intent: image ? "new-scene" : intent, mode, format, image });
  };
  const requestGeneration = () => {
    if (!prompt.trim()) return;
    if (ai.session?.entries.length) submit(false);
    else setClarificationOpen(true);
  };
  /**
   * Send from the conversation panel.
   *
   * The composer's button opens the clarification sheet first when a session is
   * empty, which is right for "Generate" in the top bar — a blank canvas is
   * worth a couple of questions. In a chat panel it reads as the button doing
   * nothing: you type a message, press Send, and a form appears instead. Here
   * the message is simply sent.
   */
  const sendChatMessage = () => {
    if (!prompt.trim()) return;
    submit(false);
  };
  const selectedProvider = ai.providers.find((provider) => provider.id === ai.providerId);
  return <div className="ai-composer" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); attachFile(event.dataTransfer.files[0]); }} onPaste={(event) => attachFile([...event.clipboardData.files].find((file) => file.type.startsWith("image/")))}>
    <div className="ai-composer-head"><span>AI COPILOT</span><div><div className="ai-connection">{ai.connected ? <><i />{selectedProvider?.label ?? "Client AI"}</> : <span>Configure AI in Settings</span>}</div><button className={sessionOpen ? "ai-session-toggle active" : "ai-session-toggle"} onClick={() => setSessionOpen((value) => !value)}>Session · {ai.session?.entries.length ?? 0}</button></div></div>
    <div className="ai-chip-row">
      <select aria-label="AI intent" value={image ? "new-scene" : intent} onChange={(event) => { setIntent(event.target.value as AiIntent); setIntentLocked(true); }} disabled={Boolean(image)}><option value="new-scene">New scene</option><option value="modify-current">Modify current</option></select>
      <select aria-label="Diagram mode" value={mode} onChange={(event) => setMode(event.target.value)}>{modes.map((value) => <option key={value} value={value}>{value === "auto" ? "Auto mode" : value}</option>)}</select>
      <select aria-label="Diagram format" value={format} onChange={(event) => setFormat(event.target.value)}>{formats.map((value) => <option key={value} value={value}>{value}</option>)}</select>
      <select aria-label="AI provider" value={ai.providerId} onChange={(event) => ai.selectProvider(event.target.value as "auto" | AiProvider["id"])}><option value="auto">Auto provider</option>{ai.providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.label}</option>)}</select>
      {selectedProvider ? <select aria-label="AI model" value={ai.model || selectedProvider.defaultModel} onChange={(event) => ai.selectModel(event.target.value)}>{selectedProvider.models.map((providerModel) => <option key={providerModel} value={providerModel}>{providerModel}</option>)}</select> : null}
      <button className={image ? "has-image" : ""} onClick={() => fileRef.current?.click()}>{image ? `${image.width}×${image.height}` : "＋ Image"}</button>
      <input ref={fileRef} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { attachFile(event.target.files?.[0]); event.currentTarget.value = ""; }} />
    </div>
    <div className="ai-composer-input"><input aria-label="AI diagram instruction" placeholder={ai.session?.entries.length ? "Continue: move MFA below Auth Service…" : "Describe the technical chart you want to create…"} value={prompt} onChange={(event) => updatePrompt(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && ai.connected && !ai.busy) requestGeneration(); }} /><button disabled={!ai.connected || ai.busy || prompt.trim().length < 2} onClick={requestGeneration} title={sendBlockedReason(ai.connected, ai.busy, prompt)}>{ai.busy ? "Working…" : ai.session?.entries.length ? "Send" : "Generate"}</button>{ai.busy ? <button className="regenerate" onClick={ai.cancel}>×</button> : <button aria-label="Regenerate proposal" className="regenerate" disabled={!ai.connected || !prompt.trim()} onClick={requestGeneration}>↻</button>}</div>
    {image ? <div className="ai-image-chip"><img src={image.dataUrl} alt="Diagram reference" /><span>Sent directly to AI Gateway</span><button onClick={() => setImage(undefined)}>Remove</button></div> : null}
    <small>{ai.status}</small>
    <button
      aria-expanded={sessionOpen}
      aria-label={sessionOpen ? "Close AI conversation" : "Open AI conversation"}
      className={[
        "ai-chat-bubble",
        sessionOpen ? "is-open" : "is-closed",
        bubble.dragging ? "is-dragging" : "",
        !sessionOpen && !everOpened ? "is-inviting" : "",
        !sessionOpen && ai.busy ? "is-busy" : "",
      ].filter(Boolean).join(" ")}
      onPointerDown={bubble.onPointerDown}
      style={{ right: `${bubble.position.right}px`, bottom: `${bubble.position.bottom}px`, width: `${launcherWidth}px`, height: `${BUBBLE_SIZE}px` }}
      title={sessionOpen ? "Close AI conversation" : "Chat with the AI — drag to move"}
      type="button"
    >
      <span className="ai-chat-bubble-mark" aria-hidden="true">{sessionOpen ? "\u00d7" : "\u2726"}</span>
      {sessionOpen ? null : <span className="ai-chat-bubble-label">{ai.busy ? "Working\u2026" : "Chat AI"}</span>}
      {!sessionOpen && ai.session?.entries.length ? <i aria-hidden="true">{ai.session.entries.length}</i> : null}
    </button>
    {sessionOpen ? <aside aria-label="AI working session" className="ai-session-panel" ref={panelRef} style={{ left: `${placement.left}px`, top: `${placement.top}px` }}>
      <header><div><span>WORKING SESSION</span><strong>{ai.session?.entries.length ? "Continue refining this chart" : "Start a chart conversation"}</strong></div><div><button disabled={ai.busy || !ai.session?.entries.length} onClick={() => { if (window.confirm("Start a new AI session for this workspace?")) ai.clearSession(); }}>New</button><button aria-label="Close AI session" onClick={() => setSessionOpen(false)}>×</button></div></header>
      <div className="ai-session-picker">
        <div><span>Past conversations</span><b>{ai.sessions.length}</b></div>
        <div className="ai-session-list">
          {ai.sessions.length ? ai.sessions.map((thread) => <article className={thread.id === ai.session?.id ? "is-active" : ""} key={thread.id}>
            <button
              className="ai-session-open"
              onClick={() => ai.openSession(thread.id)}
              title={sessionTitle(thread)}
            >
              <strong>{sessionTitle(thread)}</strong>
              <small>{thread.entries.length} message{thread.entries.length === 1 ? "" : "s"} · {new Date(thread.updatedAt).toLocaleString()}</small>
            </button>
            <button
              aria-label={`Delete conversation ${sessionTitle(thread)}`}
              className="ai-session-remove"
              onClick={() => { if (window.confirm("Delete this conversation? It cannot be recovered.")) ai.removeSession(thread.id); }}
            >×</button>
          </article>) : <p className="ai-session-empty">Nothing yet. Ask something and it is kept here.</p>}
        </div>
      </div>
      <div className="ai-session-history">{ai.session?.entries.length ? ai.session.entries.map((entry) => <article className={`is-${entry.role}`} key={entry.id}><div><b>{entry.role === "user" ? "You" : "AI"}</b>{entry.proposalStatus ? <i className={`is-${entry.proposalStatus}`}>{entry.proposalStatus}</i> : null}</div><p>{entry.body}</p></article>) : <div className="ai-session-empty"><i /><strong>No messages yet</strong><p>Describe the first chart in the composer. Follow-up messages will keep this workspace and conversation as context.</p></div>}{ai.busy && ai.activity ? <AiActivityMessage activity={ai.activity} onCancel={ai.cancel} /> : null}<div ref={sessionEndRef} /></div>
      <footer>
        <input
          aria-label="Continue AI session"
          placeholder="Adjust layout, add a path, simplify the chart…"
          value={prompt}
          onChange={(event) => updatePrompt(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter" && ai.connected && !ai.busy) sendChatMessage(); }}
        />
        {ai.connected
          ? <button disabled={ai.busy || prompt.trim().length < 2} onClick={sendChatMessage} title={sendBlockedReason(ai.connected, ai.busy, prompt)}>{ai.busy ? "…" : "Send"}</button>
          : <button className="is-connect" onClick={() => window.dispatchEvent(new Event(aiSettingsOpenEvent))} title="No AI gateway is connected yet">Connect</button>}
        {ai.connected ? null : <small>Connect an AI gateway to send messages.</small>}
      </footer>
    </aside> : null}
    {clarificationOpen ? <div className="clarification-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setClarificationOpen(false); }}>
      <section aria-label="Clarify diagram request" aria-modal="true" className="clarification-dialog" role="dialog">
        <header><div><span>BEFORE GENERATION</span><h2>Clarify the technical story</h2><p>Confirm what the AI should emphasize before it builds the chart.</p></div><button aria-label="Close clarification" onClick={() => setClarificationOpen(false)}>×</button></header>
        <div className="clarification-request"><span>YOUR PROMPT</span><p>{prompt}</p></div>
        <div className="clarification-fields">
          <label className="is-wide"><span>What should viewers understand first?</span><input autoFocus value={objective} onChange={(event) => setObjective(event.target.value)} placeholder="Example: login succeeds only after credentials and MFA are verified" /></label>
          <label><span>Audience</span><select value={audience} onChange={(event) => setAudience(event.target.value)}><option value="engineers">Engineers</option><option value="mixed technical audience">Mixed technical audience</option><option value="technical content audience">Technical content audience</option><option value="leadership">Leadership</option></select></label>
          <label><span>Detail level</span><select value={detailLevel} onChange={(event) => setDetailLevel(event.target.value)}><option value="concise">Concise</option><option value="balanced">Balanced</option><option value="detailed">Detailed</option></select></label>
          <label className="is-wide"><span>Anything that must appear? <i>Optional</i></span><input value={mustInclude} onChange={(event) => setMustInclude(event.target.value)} placeholder="Example: OAuth, MFA, session cookie, invalid credentials" /></label>
        </div>
        <footer><button onClick={() => setClarificationOpen(false)}>Back</button><button className="generate-live" disabled={objective.trim().length < 3} onClick={() => submit(true)}><i /> Generate live preview</button></footer>
      </section>
    </div> : null}
  </div>;
}

// Where the local connector is answering. The connector is loopback-only by
// default, so 127.0.0.1 stays the default. A deployed editor whose CLI lives on
// the server sets NEXT_PUBLIC_AI_CONNECTOR_URL — either an explicit origin, or
// "same-host" to reuse whatever hostname served this page, which keeps one
// build working across every address the editor is reachable on.
const connectorSetting = process.env.NEXT_PUBLIC_AI_CONNECTOR_URL?.trim();
// An empty value is a real setting, not a missing one: it says "no port, the
// connector is proxied under this origin". Only an absent variable falls back.
const connectorPortSetting = process.env.NEXT_PUBLIC_AI_CONNECTOR_PORT;
const connectorPort = connectorPortSetting === undefined ? "47821" : connectorPortSetting.trim();

// The connector on the viewer's own machine. A CLI login can only be read by a
// process on the machine holding it, so Claude CLI and Codex CLI can never come
// from the server — this address is the only place they can come from.
const ownMachineConnectorUrl = "http://127.0.0.1:47821";

function resolveConnectorUrl() {
  if (connectorSetting && connectorSetting !== "same-host") return connectorSetting.replace(/\/$/, "");
  if (connectorSetting === "same-host" && typeof window !== "undefined") {
    // No port configured means the connector is proxied under this origin —
    // same scheme, same host, whatever port the page itself is on. That is the
    // only arrangement that works from an HTTPS page, since a browser will not
    // let it call a plain-http address.
    return connectorPort ? `${window.location.protocol}//${window.location.hostname}:${connectorPort}` : window.location.origin;
  }
  return `http://127.0.0.1:${connectorPort || "47821"}`;
}

// A connector answers only if one is running AND the browser will let this page
// reach it. For the viewer's own machine that is the harder half: Chrome 142+
// gates loopback behind a Local Network Access prompt and Safari is stricter
// still, so probe before enabling any button rather than let a click fail
// cryptically.
export type BackendDetail = { id: string; label: string; models: string[]; defaultModel: string; vision?: boolean };

type Probe =
  | { state: "checking" }
  | { state: "ready"; backends: string[]; details: BackendDetail[] }
  | { state: "unreachable"; reason: string };

async function probeConnector(url: string): Promise<Probe> {
  try {
    const response = await fetch(new URL("/.well-known/technical-infographic-ai", url), {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`the connector answered ${response.status}`);
    const metadata = await response.json() as { backends?: string[]; backendDetails?: BackendDetail[] };
    const details = Array.isArray(metadata.backendDetails) ? metadata.backendDetails : [];
    return { state: "ready", backends: Array.isArray(metadata.backends) ? metadata.backends : details.map((detail) => detail.id), details };
  } catch (error) {
    // A blocked request and a connector that is not running both surface as the
    // same opaque network error, so say both rather than guess.
    const reason = error instanceof DOMException && error.name === "TimeoutError"
      ? "It did not answer in time."
      : "Either it is not running, or this browser is blocking a page on the web from reaching your machine.";
    return { state: "unreachable", reason };
  }
}

function useConnectorProbes(open: boolean) {
  const [server, setServer] = useState<Probe>({ state: "checking" });

  const check = useCallback(async () => {
    setServer({ state: "checking" });
    setServer(await probeConnector(resolveConnectorUrl()));
  }, []);

  useEffect(() => { if (open) void check(); }, [check, open]);
  return { server, check };
}

// Six ways in, differing only in where the AI runs and what has to be supplied.
type CardKind = "server" | "key";
type ConnectionCard = {
  provider: string;
  kind: CardKind;
  mark: string;
  markClass: string;
  title: string;
  blurb: string;
  missing: string;
  keyHint?: string;
  keyHelp?: string;
};

/**
 * What you can connect the editor to.
 *
 * The "local model" is the infographic server's own AI — it runs here, not on
 * the reader's machine, and calling it "local" made it sound like something
 * they had to install. The two CLI options are gone: they needed a connector
 * process running on the viewer's own computer, which almost nobody had, so
 * they showed up permanently greyed out with a "CLI not found" warning.
 *
 * What is left is the server's own model plus the three keys you can paste in.
 */
const connectionCards: ConnectionCard[] = [
  { provider: "local", kind: "server", mark: "AI", markClass: "is-local", title: "Infographic AI", blurb: "The model running on this infographic server. Nothing to install, nothing to pay, and no key — the slowest of the options, and the right one for drafts.", missing: "model server" },
  { provider: "anthropic-api", kind: "key", mark: "CL", markClass: "is-claude", title: "Claude (API key)", blurb: "Your browser calls Anthropic directly and the key never reaches this server. Billed to your API account, not a Pro/Max plan.", missing: "", keyHint: "sk-ant-…", keyHelp: "console.anthropic.com → API keys" },
  { provider: "gemini", kind: "key", mark: "GM", markClass: "is-gemini", title: "Gemini (API key)", blurb: "Your browser calls Google directly. A free AI Studio key works, and it reads attached images.", missing: "", keyHint: "AIza…", keyHelp: "aistudio.google.com → Get API key" },
  { provider: "openai", kind: "key", mark: "CX", markClass: "is-openai", title: "Codex (OpenAI key)", blurb: "Your browser calls OpenAI directly and the key never reaches this server. Billed to your API account.", missing: "", keyHint: "sk-…", keyHelp: "platform.openai.com → API keys" },
];

export function AiConnectionSettings({ open, onClose }: { open: boolean; onClose(): void }) {
  const ai = useAiAssistant();
  const [gatewayUrl, setGatewayUrl] = useState("");
  const [models, setModels] = useState<Record<string, string>>({});
  const [keys, setKeys] = useState<Record<string, string>>({});
  const { server, check } = useConnectorProbes(open);
  useEffect(() => { if (ai.gatewayOrigin && !["local-mock", "browser-direct"].includes(ai.gatewayOrigin)) setGatewayUrl(ai.gatewayOrigin); }, [ai.gatewayOrigin]);
  if (!open) return null;

  // Only the server-side model is probed now; key-based options need no probe.
  const detailFor = (card: ConnectionCard) =>
    card.kind === "server" && server.state === "ready"
      ? server.details.find((detail: { id: string }) => detail.id === card.provider)
      : undefined;

  const unavailable = (card: ConnectionCard) => {
    // A key-based option is always offered: whether the key works is something
    // only the provider can answer, and it says so when the key is saved.
    if (card.kind === "key") return undefined;
    if (server.state === "checking") return "Checking the server…";
    if (server.state === "unreachable") return `The infographic server's AI is not answering. ${server.reason}`;
    if (!server.backends.includes(card.provider)) return "This server does not offer a model right now.";
    return undefined;
  };

  const connect = (card: ConnectionCard) => {
    const detail = detailFor(card);
    const model = models[card.provider] ?? detail?.defaultModel;
    if (card.kind === "key") {
      const key = keys[card.provider]?.trim();
      if (!key) return;
      void ai.connectWithKey(card.provider as DirectProviderId, key, model)
        .then(() => setKeys((current) => ({ ...current, [card.provider]: "" })))
        .catch(() => undefined);
      return;
    }
    const url = card.kind === "server" ? resolveConnectorUrl() : ownMachineConnectorUrl;
    void ai.connect(url, card.provider, model).catch(() => undefined);
  };

  const activeProvider = ai.providers.find((provider) => provider.id === ai.providerId);

  return <div className="config-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section aria-label="Application configuration" aria-modal="true" className="config-dialog" role="dialog">
      <header><div><span>CONFIGURATION</span><h2>AI connections</h2><p>Pick where the AI runs. Prompts and diagrams go straight from this page to whatever you choose.</p></div><button aria-label="Close configuration" onClick={onClose}>×</button></header>
      <div className={`ai-config-status${ai.connected ? " is-connected" : ""}`}><i /><div><strong>{ai.connected ? activeProvider?.label ?? "AI connected" : "No active AI connection"}</strong><small>{ai.status}{ai.gatewayOrigin && ai.gatewayOrigin !== "browser-direct" ? ` · ${ai.gatewayOrigin}` : ""}</small></div>{ai.connected ? <><button onClick={ai.disconnect}>Disconnect</button><button onClick={ai.forgetGateway}>Forget</button></> : null}</div>
      <div className="ai-connection-grid">
        {connectionCards.map((card) => {
          const blocked = unavailable(card);
          const detail = detailFor(card);
          const live = ai.providers.find((provider) => provider.id === card.provider);
          const options = detail?.models ?? live?.models ?? [];
          const chosen = models[card.provider] ?? detail?.defaultModel ?? live?.defaultModel ?? "";
          const needsKey = card.kind === "key";
          return <article className={blocked ? "is-unavailable" : ""} key={card.provider} title={blocked}>
            <div className={`connection-mark ${card.markClass}`}>{card.mark}</div>
            <div>
              <strong>{card.title}</strong>
              <p>{card.blurb}</p>
              {blocked ? <small className="blocked-note">{blocked}</small> : null}
              {!blocked && detail ? <small>Ready — {detail.label}.</small> : null}
              {needsKey && live ? <small>Connected. Paste a new key to replace it.</small> : null}
              {needsKey && !live && card.keyHelp ? <small>Get one at {card.keyHelp}</small> : null}
              {needsKey ? <input aria-label={`${card.title}`} autoComplete="off" placeholder={card.keyHint} spellCheck={false} type="password" value={keys[card.provider] ?? ""} onChange={(event) => setKeys((current) => ({ ...current, [card.provider]: event.target.value }))} /> : null}
              {options.length > 1 ? <select aria-label={`${card.title} model`} value={chosen} onChange={(event) => setModels((current) => ({ ...current, [card.provider]: event.target.value }))}>{options.map((model) => <option key={model} value={model}>{model}</option>)}</select> : null}
            </div>
            <button disabled={ai.busy || Boolean(blocked) || (needsKey && !keys[card.provider]?.trim())} onClick={() => connect(card)} title={blocked}>
              {needsKey && live ? "Replace key" : `Connect ${card.title.split(" ")[0]}`}
            </button>
          </article>;
        })}
        <article className="is-organization"><div className="connection-mark is-gateway">GW</div><div><strong>Organization Gateway</strong><p>Connect to an AI Gateway controlled by your organization through SSO.</p><input aria-label="Organization AI Gateway URL" inputMode="url" placeholder="https://ai.your-company.com" value={gatewayUrl} onChange={(event) => setGatewayUrl(event.target.value)} /></div><button disabled={ai.busy || !gatewayUrl.trim()} onClick={() => void ai.connect(gatewayUrl).catch(() => undefined)}>Continue with SSO</button></article>
      </div>
      <footer className={server.state === "ready" ? "" : "is-warning"}>
        <span>INFOGRAPHIC AI</span>
        {server.state === "ready"
          ? <><code>ready · {server.backends.length ? server.backends.join(", ") : "no model reported"}</code><small>Runs on this server. Prompts for the key-based options never touch it — those go from your browser straight to the provider.</small></>
          : <><code>{server.state === "checking" ? "checking…" : "not reachable"}</code><small>The server model is unavailable right now. The three key options below work regardless.</small></>}
        <button className="recheck" disabled={server.state === "checking"} onClick={() => void check()}>{server.state === "checking" ? "Checking…" : "Check again"}</button>
      </footer>
    </section>
  </div>;
}

export function ProposalControls() {
  const ai = useAiAssistant();
  if (!ai.proposal) return null;
  const counts = proposalChangeCounts(ai.proposal.proposal);
  return <div className={`proposal-controls${ai.proposal.stale ? " is-stale" : ""}${ai.proposal.building ? " is-building" : ""}`}>
    <div><span>{ai.proposal.building ? "LIVE BUILD" : "AI PROPOSAL"}</span><strong>{ai.proposal.proposal.summary}</strong><small>{ai.proposal.building ? ai.proposal.buildProgress : `+${counts.added} · ~${counts.modified} · −${counts.deleted}${ai.proposal.stale ? " · Diagram changed; regenerate required" : ""}`}</small></div>
    <div><button disabled={ai.proposal.building} onClick={ai.reject}>Reject</button><button className="accept" disabled={ai.proposal.stale || ai.proposal.building} onClick={() => void ai.accept()}>{ai.proposal.building ? "Drawing…" : "Accept all"}</button></div>
  </div>;
}

export function usePreviewDocument(fallback: DiagramDocument) {
  return useAiAssistant().proposal?.document ?? fallback;
}

export function ItemCommentThread({ workspaceId, nodeIds, edgeIds }: { workspaceId: string; nodeIds: string[]; edgeIds: string[] }) {
  const ai = useAiAssistant();
  const targetIds = useMemo(() => [...nodeIds.map((id) => `node:${id}`), ...edgeIds.map((id) => `edge:${id}`)], [edgeIds, nodeIds]);
  const [thread, setThread] = useState<AiThread>();
  const [draft, setDraft] = useState("");
  const key = targetIds.join("|");
  useEffect(() => {
    if (!targetIds.length) { setThread(undefined); return; }
    void loadThread(workspaceId, targetIds).then((stored) => setThread(stored ?? createThread(workspaceId, targetIds, targetIds.length > 1 ? "selection" : nodeIds.length ? "node" : "edge")));
  }, [key, nodeIds.length, workspaceId]);
  if (!targetIds.length || !thread) return null;
  const sendComment = async () => {
    const body = draft.trim(); if (!body) return;
    const next = { ...thread, entries: [...thread.entries, { id: crypto.randomUUID(), role: "user" as const, body, createdAt: new Date().toISOString() }], updatedAt: new Date().toISOString() };
    setThread(next); setDraft(""); await saveThread(next);
    const proposal = await ai.send({ prompt: body, intent: "modify-selection", thread: next });
    if (!proposal) return;
    const updated: AiThread = { ...next, summary: proposal.threadSummary, entries: [...next.entries, { id: crypto.randomUUID(), role: "assistant", body: proposal.explanation || proposal.summary, createdAt: new Date().toISOString(), proposalId: proposal.id, proposalStatus: "pending" }], updatedAt: new Date().toISOString() };
    setThread(updated); await saveThread(updated);
  };
  return <section className="ai-thread"><label>COMMENTS · LOCAL</label><div className="thread-entries">{thread.entries.slice(-4).map((entry) => <div className={`thread-entry is-${entry.role}`} key={entry.id}><b>{entry.role === "user" ? "You" : "AI"}</b><p>{entry.body}</p></div>)}</div><textarea aria-label="Comment for AI" placeholder="Comment on selected item…" value={draft} onChange={(event) => setDraft(event.target.value)} /><button disabled={!ai.connected || ai.busy || !draft.trim()} onClick={() => void sendComment()}>Send to AI · {targetIds.length} item{targetIds.length === 1 ? "" : "s"}</button></section>;
}
