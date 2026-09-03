"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ZodError } from "zod";
import type { DiagramDocument } from "@/modules/diagram/schema";
import { buildProposalDocument, createProposalRevealFrames, decorateProposalDocument, proposalChangeCounts, validateProposal } from "./proposal-engine";
import { sceneFingerprint, scopedDiagramContext } from "./context";
import { rememberGatewayOrigin } from "@/modules/projects/user-settings";
import { DirectGatewayConnector, MockGatewayConnector, clearClientGatewayUrl, discoverCapabilities, discoverClientGateway, saveClientGatewayUrl, savePendingProvider, savedClientGatewayUrl, takePendingProvider, type AiConnector, type AiProgress } from "./gateway";
import { completePkceAuthorization, beginPkceAuthorization } from "./pkce";
import { sanitizeDiagramImage } from "./image-input";
import { createThread, loadThread, saveThread, threadContext, updateThreadProposalStatus, type AiThread } from "./thread-store";
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
  connect(gatewayUrl: string, preferredProvider?: string): Promise<void>;
  disconnect(): void;
  forgetGateway(): void;
  cancel(): void;
  reject(): void;
  selectProvider(providerId: "auto" | AiProvider["id"]): void;
  selectModel(model: string): void;
  accept(): Promise<void>;
  send(input: AiSendInput): Promise<DiagramProposal | undefined>;
  sendSession(input: Omit<AiSendInput, "thread">): Promise<DiagramProposal | undefined>;
  clearSession(): void;
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
  const [model, setModel] = useState("");
  const [gatewayOrigin, setGatewayOrigin] = useState<string>();
  const [proposal, setProposal] = useState<ProposalState>();
  const [session, setSession] = useState<AiThread>();
  const controllerRef = useRef<AbortController | undefined>(undefined);
  const requestFailureRef = useRef<string | undefined>(undefined);
  const documentRef = useRef(document);
  documentRef.current = document;

  useEffect(() => {
    let active = true;
    setProposal(undefined);
    void loadThread(document.id, ["workspace"]).then((stored) => {
      if (active) setSession(stored ?? createThread(document.id, ["workspace"], "workspace"));
    });
    return () => { active = false; };
  }, [document.id]);

  useEffect(() => {
    if (!proposal) return;
    const fingerprint = sceneFingerprint(document, proposal.targetNodeIds, proposal.targetEdgeIds);
    if (fingerprint !== proposal.fingerprint) setProposal((current) => current ? { ...current, stale: true } : current);
  }, [document, proposal?.fingerprint, revision]);

  useEffect(() => {
    if (process.env.NEXT_PUBLIC_AI_GATEWAY_MOCK === "true") { setStatus("Development AI available"); return; }
    const saved = savedClientGatewayUrl();
    if (!saved) { setStatus("Connect your Client AI Gateway"); return; }
    setGatewayOrigin(saved);
    const callback = new URLSearchParams(window.location.search).has("code");
    if (!callback) { setStatus("Client AI Gateway ready to connect"); return; }
    void discoverClientGateway(saved).then(async ({ metadata: nextMetadata }) => {
      const token = await completePkceAuthorization();
      if (!token) throw new Error("Client AI authorization callback is incomplete");
      const discovered = await discoverCapabilities(nextMetadata, token);
      setConnector(new DirectGatewayConnector(nextMetadata, token, discovered));
      const preferredProvider = takePendingProvider();
      const selectedProvider = discovered.providers.find((provider) => provider.id === preferredProvider);
      if (selectedProvider) { setProviderId(selectedProvider.id); setModel(selectedProvider.defaultModel); }
      setStatus(`${selectedProvider?.label ?? "Client AI"} connected`);
    }).catch((error) => setStatus(error instanceof Error ? error.message : "Client AI Gateway unavailable"));
  }, []);

  const connect = useCallback(async (gatewayUrl: string, preferredProvider?: string) => {
    try {
      if (process.env.NEXT_PUBLIC_AI_GATEWAY_MOCK === "true") {
        setConnector(new MockGatewayConnector());
        setGatewayOrigin("local-mock");
        setStatus("Development AI connected");
        return;
      }
      const connectionLabel = preferredProvider === "codex" ? "Codex Local" : preferredProvider === "anthropic" ? "Claude Local" : "Organization Gateway";
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
      await beginPkceAuthorization(nextMetadata);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Client AI Gateway unavailable");
      throw error;
    }
  }, []);

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
      const appliedDocument = await buildProposalDocument(baseDocument, raw);
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
    const next = createThread(documentRef.current.id, ["workspace"], "workspace");
    setSession(next);
    setProposal(undefined);
    void saveThread(next);
    setStatus("New AI session started");
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
  const value = useMemo<AssistantContextValue>(() => ({ connected: Boolean(connector), busy, status, activity, providers: connector?.providers ?? [], providerId, model, gatewayOrigin, proposal, session, connect, disconnect, forgetGateway, cancel, reject, selectProvider, selectModel: setModel, accept, send, sendSession, clearSession }), [accept, activity, busy, cancel, clearSession, connect, connector, disconnect, forgetGateway, gatewayOrigin, model, proposal, providerId, reject, selectProvider, send, sendSession, session, status]);
  return <AssistantContext.Provider value={value}>{children}</AssistantContext.Provider>;
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
    <div className="ai-composer-input"><input aria-label="AI diagram instruction" placeholder={ai.session?.entries.length ? "Continue: move MFA below Auth Service…" : "Describe the technical chart you want to create…"} value={prompt} onChange={(event) => updatePrompt(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && ai.connected && !ai.busy) requestGeneration(); }} /><button disabled={!ai.connected || ai.busy || prompt.trim().length < 2} onClick={requestGeneration}>{ai.busy ? "Working…" : ai.session?.entries.length ? "Send" : "Generate"}</button>{ai.busy ? <button className="regenerate" onClick={ai.cancel}>×</button> : <button aria-label="Regenerate proposal" className="regenerate" disabled={!ai.connected || !prompt.trim()} onClick={requestGeneration}>↻</button>}</div>
    {image ? <div className="ai-image-chip"><img src={image.dataUrl} alt="Diagram reference" /><span>Sent directly to AI Gateway</span><button onClick={() => setImage(undefined)}>Remove</button></div> : null}
    <small>{ai.status}</small>
    {sessionOpen ? <aside aria-label="AI working session" className="ai-session-panel">
      <header><div><span>WORKING SESSION</span><strong>{ai.session?.entries.length ? "Continue refining this chart" : "Start a chart conversation"}</strong></div><div><button disabled={ai.busy || !ai.session?.entries.length} onClick={() => { if (window.confirm("Start a new AI session for this workspace?")) ai.clearSession(); }}>New</button><button aria-label="Close AI session" onClick={() => setSessionOpen(false)}>×</button></div></header>
      <div className="ai-session-history">{ai.session?.entries.length ? ai.session.entries.slice(-20).map((entry) => <article className={`is-${entry.role}`} key={entry.id}><div><b>{entry.role === "user" ? "You" : "AI"}</b>{entry.proposalStatus ? <i className={`is-${entry.proposalStatus}`}>{entry.proposalStatus}</i> : null}</div><p>{entry.body}</p></article>) : <div className="ai-session-empty"><i /><strong>No messages yet</strong><p>Describe the first chart in the composer. Follow-up messages will keep this workspace and conversation as context.</p></div>}{ai.busy && ai.activity ? <AiActivityMessage activity={ai.activity} onCancel={ai.cancel} /> : null}<div ref={sessionEndRef} /></div>
      <footer><input aria-label="Continue AI session" placeholder="Adjust layout, add a path, simplify the chart…" value={prompt} onChange={(event) => updatePrompt(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && ai.connected && !ai.busy) requestGeneration(); }} /><button disabled={!ai.connected || ai.busy || prompt.trim().length < 2} onClick={requestGeneration}>{ai.busy ? "…" : "Send"}</button></footer>
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

const localConnectorUrl = "http://127.0.0.1:47821";

// The Local buttons only work if a connector is answering on this machine AND
// the browser is willing to let this page reach it. Chrome 142+ gates that
// behind a Local Network Access prompt, Safari is stricter still, and a plain
// click on a dead button just produces a cryptic failure. So probe first, and
// keep the buttons off until we know they will do something.
type LocalProbe =
  | { state: "checking" }
  | { state: "ready"; backends: string[] }
  | { state: "unreachable"; reason: string };

function useLocalConnector(open: boolean) {
  const [probe, setProbe] = useState<LocalProbe>({ state: "checking" });

  const check = useCallback(async () => {
    setProbe({ state: "checking" });
    try {
      const response = await fetch(new URL("/.well-known/technical-infographic-ai", localConnectorUrl), {
        cache: "no-store",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(3000),
      });
      if (!response.ok) throw new Error(`the connector answered ${response.status}`);
      const metadata = await response.json() as { backends?: string[] };
      setProbe({ state: "ready", backends: Array.isArray(metadata.backends) ? metadata.backends : [] });
    } catch (error) {
      // A blocked request and a connector that is not running both surface as
      // the same opaque network error, so say both rather than guess.
      const secure = typeof window !== "undefined" && window.location.protocol === "https:";
      const reason = error instanceof DOMException && error.name === "TimeoutError"
        ? "The connector did not answer in time."
        : secure
          ? "Either the connector is not running, or this browser is blocking a page on the web from reaching your machine."
          : "The connector does not seem to be running.";
      setProbe({ state: "unreachable", reason });
    }
  }, []);

  useEffect(() => {
    if (open) void check();
  }, [check, open]);

  return { probe, check };
}

export function AiConnectionSettings({ open, onClose }: { open: boolean; onClose(): void }) {
  const ai = useAiAssistant();
  const [gatewayUrl, setGatewayUrl] = useState("");
  const { probe, check } = useLocalConnector(open);
  useEffect(() => { if (ai.gatewayOrigin && ai.gatewayOrigin !== "local-mock") setGatewayUrl(ai.gatewayOrigin); }, [ai.gatewayOrigin]);
  if (!open) return null;

  const localReady = probe.state === "ready";
  const localBusy = probe.state === "checking";
  const has = (provider: string) => localReady && (probe.backends.length === 0 || probe.backends.includes(provider));
  const unavailable = (provider: string, cli: string) => {
    if (localBusy) return "Looking for a connector on this machine…";
    if (probe.state === "unreachable") return `No connector on this machine. ${probe.reason} Start it with: npx technical-infographic-connector`;
    if (!has(provider)) return `A connector is running, but it did not find the ${cli} on this machine.`;
    return undefined;
  };
  const codexBlocked = unavailable("codex", "Codex CLI");
  const claudeBlocked = unavailable("anthropic", "Claude CLI");
  const connect = (url: string, provider?: string) => void ai.connect(url, provider).catch(() => undefined);
  const activeProvider = ai.providers.find((provider) => provider.id === ai.providerId);
  return <div className="config-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section aria-label="Application configuration" aria-modal="true" className="config-dialog" role="dialog">
      <header><div><span>CONFIGURATION</span><h2>AI connections</h2><p>Use AI authenticated and owned by this client.</p></div><button aria-label="Close configuration" onClick={onClose}>×</button></header>
      <div className={`ai-config-status${ai.connected ? " is-connected" : ""}`}><i /><div><strong>{ai.connected ? activeProvider?.label ?? "Client AI connected" : "No active AI connection"}</strong><small>{ai.status}{ai.gatewayOrigin ? ` · ${ai.gatewayOrigin}` : ""}</small></div>{ai.connected ? <><button onClick={ai.disconnect}>Disconnect</button><button onClick={ai.forgetGateway}>Forget</button></> : null}</div>
      <div className="ai-connection-grid">
        <article className={codexBlocked ? "is-unavailable" : ""} title={codexBlocked}>
          <div className="connection-mark is-codex">CX</div>
          <div><strong>Codex Local</strong><p>Use the Codex CLI login on this machine. No OpenAI API key enters the editor.</p>{codexBlocked ? <small className="blocked-note">{codexBlocked}</small> : <small>Ready — the connector found the Codex CLI here.</small>}</div>
          <button disabled={ai.busy || Boolean(codexBlocked)} onClick={() => connect(localConnectorUrl, "codex")} title={codexBlocked}>Connect Codex</button>
        </article>
        <article className={claudeBlocked ? "is-unavailable" : ""} title={claudeBlocked}>
          <div className="connection-mark is-claude">CL</div>
          <div><strong>Claude Local</strong><p>Use the Claude Code login already held by the CLI on this machine.</p>{claudeBlocked ? <small className="blocked-note">{claudeBlocked}</small> : <small>Ready — the connector found the Claude CLI here.</small>}</div>
          <button disabled={ai.busy || Boolean(claudeBlocked)} onClick={() => connect(localConnectorUrl, "anthropic")} title={claudeBlocked}>Connect Claude</button>
        </article>
        <article className="is-organization"><div className="connection-mark is-gateway">GW</div><div><strong>Organization Gateway</strong><p>Connect to an AI Gateway controlled by your organization through SSO.</p><input aria-label="Organization AI Gateway URL" inputMode="url" placeholder="https://ai.your-company.com" value={gatewayUrl} onChange={(event) => setGatewayUrl(event.target.value)} /></div><button disabled={ai.busy || !gatewayUrl.trim()} onClick={() => connect(gatewayUrl)}>Continue with SSO</button></article>
      </div>
      <footer className={probe.state === "unreachable" ? "is-warning" : ""}>
        <span>LOCAL CONNECTOR</span>
        {probe.state === "ready"
          ? <><code>connected · {probe.backends.length ? probe.backends.join(", ") : "no backend reported"}</code><small>Running on 127.0.0.1 only. Credentials stay in the CLI that owns them.</small></>
          : <><code>npx technical-infographic-connector</code><small>{probe.state === "checking" ? "Looking for a connector on this machine…" : `${probe.reason} Run the command above in a terminal, then check again.`}</small></>}
        <button className="recheck" disabled={localBusy} onClick={() => void check()}>{localBusy ? "Checking…" : "Check again"}</button>
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
