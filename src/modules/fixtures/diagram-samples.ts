import type { DiagramPlan } from "@/modules/diagram/schema";
import { architecturePlan } from "./architecture-plan";
import {
  cachingTemplate, cicdTemplate, cqrsTemplate, microservicesTemplate, multiRegionTemplate,
  oauthTemplate, observabilityTemplate, ragTemplate, serverlessTemplate, webhookTemplate,
} from "./architecture-templates";

/**
 * Templates are grouped so the picker can be read at a glance: the "Diagram
 * kinds" show what each mode looks like, the rest are architectures you start
 * from and rename.
 */
export type TemplateCategory = "Diagram kinds" | "Architecture" | "Data & events" | "AI" | "Delivery";

type DiagramSample = {
  id: string;
  number: number;
  label: string;
  description: string;
  category: TemplateCategory;
  plan: DiagramPlan;
};

const samples: DiagramPlan[] = [
  {
    id: "sample-flow", mode: "flow", title: "Checkout decision flow", purpose: "Show the primary checkout path and its decision branch.",
    nodes: [
      { id: "start", label: "Cart ready", role: "start", detail: "checkout begins", lane: "entry" },
      { id: "validate", label: "Validate cart", role: "process", detail: "price and inventory", lane: "core" },
      { id: "stock", label: "In stock?", role: "decision", detail: "branch by availability", lane: "core" },
      { id: "pay", label: "Take payment", role: "process", detail: "authorize charge", lane: "core" },
      { id: "end", label: "Order placed", role: "end", detail: "checkout complete", lane: "core" },
    ],
    edges: [
      { id: "f1", from: "start", to: "validate", semantics: "request", important: true, label: "begin" },
      { id: "f2", from: "validate", to: "stock", semantics: "request", important: true },
      { id: "f3", from: "stock", to: "pay", semantics: "success", important: true, label: "yes" },
      { id: "f4", from: "pay", to: "end", semantics: "success", important: true },
    ],
  },
  {
    id: "sample-sequence", mode: "sequence", title: "Authentication sequence", purpose: "Explain token issuance across client, API, identity provider, and storage.",
    nodes: [
      { id: "client", label: "Web client", role: "actor", detail: "browser", lane: "entry" },
      { id: "api", label: "Auth API", role: "service", detail: "credential boundary", lane: "core" },
      { id: "idp", label: "Identity provider", role: "gateway", detail: "OIDC", lane: "core" },
      { id: "session", label: "Session store", role: "cache", detail: "active sessions", lane: "data" },
    ],
    edges: [
      { id: "s1", from: "client", to: "api", semantics: "request", important: true, label: "sign in" },
      { id: "s2", from: "api", to: "idp", semantics: "request", important: true, label: "verify" },
      { id: "s3", from: "idp", to: "api", semantics: "success", important: true, label: "claims" },
      { id: "s4", from: "api", to: "session", semantics: "data", important: false, label: "store" },
    ],
  },
  {
    id: "sample-pipeline", mode: "data-pipeline", title: "Streaming data pipeline", purpose: "Trace events from ingestion through enrichment, storage, and serving.",
    nodes: [
      { id: "source", label: "Event source", role: "input-output", detail: "application events", lane: "entry" },
      { id: "ingest", label: "Ingest", role: "event-bus", detail: "Kafka topics", lane: "async" },
      { id: "enrich", label: "Enrichment", role: "worker", detail: "stream processor", lane: "async" },
      { id: "store", label: "Analytics store", role: "stored-data", detail: "columnar data", lane: "data" },
      { id: "serve", label: "Query API", role: "service", detail: "serving layer", lane: "core" },
    ],
    edges: [
      { id: "p1", from: "source", to: "ingest", semantics: "event", important: true },
      { id: "p2", from: "ingest", to: "enrich", semantics: "event", important: true },
      { id: "p3", from: "enrich", to: "store", semantics: "data", important: true },
      { id: "p4", from: "store", to: "serve", semantics: "data", important: true },
    ],
  },
  {
    id: "sample-events", mode: "event-driven", title: "Order event fan-out", purpose: "Separate the synchronous order write from asynchronous consumers.",
    nodes: [
      { id: "orders", label: "Order service", role: "service", detail: "transaction owner", lane: "core" },
      { id: "bus", label: "Order events", role: "event-bus", detail: "fan-out channel", lane: "async" },
      { id: "inventory", label: "Inventory worker", role: "worker", detail: "reserve stock", lane: "async" },
      { id: "email", label: "Email worker", role: "worker", detail: "send receipt", lane: "async" },
      { id: "db", label: "Orders DB", role: "database", detail: "order state", lane: "data" },
    ],
    edges: [
      { id: "e1", from: "orders", to: "db", semantics: "data", important: true, label: "commit" },
      { id: "e2", from: "orders", to: "bus", semantics: "event", important: true, label: "OrderCreated" },
      { id: "e3", from: "bus", to: "inventory", semantics: "event", important: true },
      { id: "e4", from: "bus", to: "email", semantics: "event", important: false },
    ],
  },
  {
    id: "sample-agent", mode: "agent-loop", title: "AI agent tool loop", purpose: "Show planning, tool execution, observation, and completion.",
    nodes: [
      { id: "user", label: "User request", role: "actor", detail: "task context", lane: "entry" },
      { id: "agent", label: "Agent", role: "agent", detail: "plan and evaluate", lane: "core" },
      { id: "tools", label: "Tool runner", role: "tool", detail: "search and execute", lane: "core" },
      { id: "observe", label: "Observation", role: "document", detail: "tool result", lane: "async" },
      { id: "done", label: "Final response", role: "end", detail: "completed", lane: "core" },
    ],
    edges: [
      { id: "a1", from: "user", to: "agent", semantics: "request", important: true },
      { id: "a2", from: "agent", to: "tools", semantics: "request", important: true, label: "tool call" },
      { id: "a3", from: "tools", to: "observe", semantics: "feedback", important: true },
      { id: "a4", from: "observe", to: "agent", semantics: "feedback", important: true, label: "incomplete" },
      { id: "a5", from: "agent", to: "done", semantics: "success", important: true, label: "complete" },
    ],
  },
];

const infrastructureSample: DiagramPlan = {
  id: "sample-infrastructure", mode: "infrastructure", title: "Kubernetes production stack", purpose: "Trace traffic from the public edge through workloads, caching, and durable storage.",
  nodes: [
    { id: "infra-user", label: "Client", role: "actor", detail: "external traffic", lane: "entry" },
    { id: "infra-lb", label: "Cloud load balancer", role: "gateway", detail: "TLS and health routing", technology: "cloudflare", lane: "core" },
    { id: "infra-ingress", label: "Kubernetes ingress", role: "gateway", detail: "cluster routing", technology: "kubernetes", lane: "core" },
    { id: "infra-app", label: "Application pods", role: "service", detail: "autoscaled workloads", technology: "kubernetes", lane: "core" },
    { id: "infra-cache", label: "Redis", role: "cache", detail: "shared cache", technology: "redis", lane: "data" },
    { id: "infra-db", label: "PostgreSQL", role: "database", detail: "durable state", technology: "postgresql", lane: "data" },
  ],
  edges: [
    { id: "i1", from: "infra-user", to: "infra-lb", semantics: "request", important: true },
    { id: "i2", from: "infra-lb", to: "infra-ingress", semantics: "request", important: true },
    { id: "i3", from: "infra-ingress", to: "infra-app", semantics: "request", important: true },
    { id: "i4", from: "infra-app", to: "infra-cache", semantics: "data", important: false, label: "hot reads" },
    { id: "i5", from: "infra-app", to: "infra-db", semantics: "data", important: true, label: "transactions" },
  ],
};

const comparisonSample: DiagramPlan = {
  id: "sample-comparison", mode: "comparison", title: "REST vs event-driven integration", purpose: "Compare request coupling, delivery, and failure behavior across two integration styles.",
  nodes: [
    { id: "rest-title", label: "REST request", role: "gateway", detail: "synchronous", lane: "entry" },
    { id: "rest-coupling", label: "Direct dependency", role: "service", detail: "caller waits", lane: "core" },
    { id: "rest-failure", label: "Immediate failure", role: "end", detail: "retry at caller", lane: "core" },
    { id: "event-title", label: "Domain event", role: "event-bus", detail: "asynchronous", lane: "async" },
    { id: "event-coupling", label: "Loose coupling", role: "worker", detail: "consumer controls pace", lane: "async" },
    { id: "event-failure", label: "Durable retry", role: "event-bus", detail: "recover independently", lane: "async" },
  ],
  edges: [
    { id: "c1", from: "rest-title", to: "rest-coupling", semantics: "request", important: true },
    { id: "c2", from: "rest-coupling", to: "rest-failure", semantics: "failure", important: true },
    { id: "c3", from: "event-title", to: "event-coupling", semantics: "event", important: true },
    { id: "c4", from: "event-coupling", to: "event-failure", semantics: "event", important: true },
  ],
};

const explainerGridSample: DiagramPlan = {
  id: "sample-explainer-grid", mode: "explainer-grid", title: "Six building blocks of a reliable API", purpose: "Explain one engineering concept per card with a clear reading order.",
  nodes: [
    { id: "x1", label: "Authenticate", role: "gateway", detail: "verify identity", technology: "oauth", lane: "core" },
    { id: "x2", label: "Authorize", role: "decision", detail: "enforce access policy", lane: "core" },
    { id: "x3", label: "Rate limit", role: "gateway", detail: "protect capacity", lane: "core" },
    { id: "x4", label: "Validate", role: "process", detail: "reject invalid input", lane: "core" },
    { id: "x5", label: "Observe", role: "service", detail: "measure latency and errors", technology: "prometheus", lane: "core" },
    { id: "x6", label: "Recover", role: "worker", detail: "retry safely", lane: "core" },
  ],
  edges: [],
};

const diagramSampleDefinitions: Array<Omit<DiagramSample, "number">> = [
  { id: "architecture", category: "Diagram kinds", label: "Architecture", description: "Synchronous services, async work, and data", plan: architecturePlan },
  { id: "flow", category: "Diagram kinds", label: "Flow", description: "Decision-driven checkout path", plan: samples[0] },
  { id: "sequence", category: "Diagram kinds", label: "Sequence", description: "Authentication messages and return path", plan: samples[1] },
  { id: "data-pipeline", category: "Diagram kinds", label: "Data pipeline", description: "Ingest, enrich, store, and serve", plan: samples[2] },
  { id: "event-driven", category: "Diagram kinds", label: "Event-driven", description: "Transactional write and async fan-out", plan: samples[3] },
  { id: "agent-loop", category: "Diagram kinds", label: "Agent loop", description: "Tool execution and feedback cycle", plan: samples[4] },
  { id: "infrastructure", category: "Diagram kinds", label: "Infrastructure", description: "Production Kubernetes request path", plan: infrastructureSample },
  { id: "comparison", category: "Diagram kinds", label: "Comparison", description: "REST versus event-driven integration", plan: comparisonSample },
  { id: "explainer-grid", category: "Diagram kinds", label: "Explainer grid", description: "One concept per engineering card", plan: explainerGridSample },

  { id: "microservices", category: "Architecture", label: "Microservices", description: "One gateway in front of independent services", plan: microservicesTemplate },
  { id: "caching", category: "Architecture", label: "Caching layers", description: "Browser, edge, process, shared, database", plan: cachingTemplate },
  { id: "serverless", category: "Architecture", label: "Serverless API", description: "Managed edge, functions, key-value store", plan: serverlessTemplate },
  { id: "multi-region", category: "Architecture", label: "Multi-region", description: "Active-passive with a promoted replica", plan: multiRegionTemplate },

  { id: "cqrs", category: "Data & events", label: "CQRS + event sourcing", description: "Append events, project a read model", plan: cqrsTemplate },
  { id: "webhooks", category: "Data & events", label: "Webhook delivery", description: "Retry with backoff, then dead-letter", plan: webhookTemplate },
  { id: "observability", category: "Data & events", label: "Observability", description: "Metrics, logs, traces and who is paged", plan: observabilityTemplate },

  { id: "rag", category: "AI", label: "RAG pipeline", description: "Retrieve, rerank, answer with citations", plan: ragTemplate },

  { id: "cicd", category: "Delivery", label: "CI/CD pipeline", description: "Commit to verified production release", plan: cicdTemplate },
  { id: "oauth", category: "Delivery", label: "OAuth 2.0 + PKCE", description: "Authorization code, both outcomes", plan: oauthTemplate },
];

export const templateCategories: TemplateCategory[] = ["Diagram kinds", "Architecture", "Data & events", "AI", "Delivery"];

export const diagramSamples: DiagramSample[] = diagramSampleDefinitions.map((sample, index) => ({ ...sample, number: index + 1 }));
