import type { DiagramPlan } from "@/modules/diagram/schema";

/**
 * Starting points for the shapes people actually draw.
 *
 * The nine originals were one per diagram mode — useful for showing what the
 * editor can do, thin as a place to start real work. These are the recurring
 * architectures instead: each one is a correct, opinionated sketch you can
 * rename into your own system rather than a demo of a feature.
 *
 * Every plan follows the house rules the AI is given: lanes carry meaning
 * (entry for callers, core for the synchronous path, async for queues and
 * workers, data for stores), edge semantics are honest, and the primary path is
 * marked important so it reads first.
 */

export const microservicesTemplate: DiagramPlan = {
  id: "template-microservices",
  mode: "architecture",
  title: "Microservices with a gateway",
  purpose: "One entry point in front of independently deployed services.",
  nodes: [
    { id: "web", label: "Web app", role: "actor", detail: "browser", lane: "entry" },
    { id: "mobile", label: "Mobile app", role: "actor", detail: "iOS and Android", lane: "entry" },
    { id: "gateway", label: "API gateway", role: "gateway", detail: "routing and authn", technology: "nginx", lane: "core" },
    { id: "orders", label: "Orders", role: "service", detail: "order lifecycle", lane: "core" },
    { id: "catalog", label: "Catalog", role: "service", detail: "products and pricing", lane: "core" },
    { id: "billing", label: "Billing", role: "service", detail: "invoices and refunds", lane: "core" },
    { id: "bus", label: "Event bus", role: "event-bus", detail: "domain events", technology: "kafka", lane: "async" },
    { id: "search", label: "Search indexer", role: "worker", detail: "rebuilds the index", lane: "async" },
    { id: "orders-db", label: "Orders DB", role: "database", detail: "orders and lines", technology: "postgresql", lane: "data" },
    { id: "catalog-db", label: "Catalog DB", role: "database", detail: "products", technology: "postgresql", lane: "data" },
    { id: "index", label: "Search index", role: "stored-data", detail: "read model", technology: "elasticsearch", lane: "data" },
  ],
  edges: [
    { id: "m1", from: "web", to: "gateway", semantics: "request", important: true },
    { id: "m2", from: "mobile", to: "gateway", semantics: "request", important: false },
    { id: "m3", from: "gateway", to: "orders", semantics: "request", important: true },
    { id: "m4", from: "gateway", to: "catalog", semantics: "request", important: false },
    { id: "m5", from: "orders", to: "billing", semantics: "request", important: true, label: "charge" },
    { id: "m6", from: "orders", to: "orders-db", semantics: "data", important: true },
    { id: "m7", from: "catalog", to: "catalog-db", semantics: "data", important: false },
    { id: "m8", from: "orders", to: "bus", semantics: "event", important: true, label: "OrderPlaced" },
    { id: "m9", from: "bus", to: "search", semantics: "event", important: false },
    { id: "m10", from: "search", to: "index", semantics: "data", important: false },
  ],
};

export const cqrsTemplate: DiagramPlan = {
  id: "template-cqrs",
  mode: "event-driven",
  title: "CQRS with event sourcing",
  purpose: "Writes append events; reads come from a projection built from them.",
  nodes: [
    { id: "client", label: "Client", role: "actor", detail: "issues commands", lane: "entry" },
    { id: "command", label: "Command API", role: "service", detail: "validates intent", lane: "core" },
    { id: "aggregate", label: "Aggregate", role: "process", detail: "decides what happened", lane: "core" },
    { id: "query", label: "Query API", role: "service", detail: "serves the read model", lane: "core" },
    { id: "store", label: "Event store", role: "event-bus", detail: "append-only log", lane: "async" },
    { id: "projector", label: "Projector", role: "worker", detail: "folds events forward", lane: "async" },
    { id: "events", label: "Event log", role: "stored-data", detail: "source of truth", technology: "postgresql", lane: "data" },
    { id: "readmodel", label: "Read model", role: "database", detail: "query-shaped", technology: "mongodb", lane: "data" },
  ],
  edges: [
    { id: "c1", from: "client", to: "command", semantics: "request", important: true, label: "command" },
    { id: "c2", from: "command", to: "aggregate", semantics: "request", important: true },
    { id: "c3", from: "aggregate", to: "store", semantics: "event", important: true, label: "append" },
    { id: "c4", from: "store", to: "events", semantics: "data", important: true },
    { id: "c5", from: "store", to: "projector", semantics: "event", important: true },
    { id: "c6", from: "projector", to: "readmodel", semantics: "data", important: true },
    { id: "c7", from: "client", to: "query", semantics: "request", important: false, label: "query" },
    { id: "c8", from: "query", to: "readmodel", semantics: "data", important: false },
  ],
};

export const ragTemplate: DiagramPlan = {
  id: "template-rag",
  mode: "agent-loop",
  title: "Retrieval-augmented generation",
  purpose: "Ground a model's answer in documents you control.",
  nodes: [
    { id: "user", label: "User question", role: "actor", detail: "natural language", lane: "entry" },
    { id: "api", label: "Answer API", role: "service", detail: "orchestrates the turn", lane: "core" },
    { id: "embed", label: "Embed query", role: "process", detail: "question to vector", lane: "core" },
    { id: "retrieve", label: "Retrieve", role: "tool", detail: "top-k passages", lane: "core" },
    { id: "rerank", label: "Rerank", role: "process", detail: "keep what is relevant", lane: "core" },
    { id: "model", label: "LLM", role: "model", detail: "answers from context", lane: "core" },
    { id: "guard", label: "Grounded?", role: "decision", detail: "cite or refuse", lane: "core" },
    { id: "ingest", label: "Ingestion", role: "worker", detail: "chunk and embed", lane: "async" },
    { id: "vectors", label: "Vector store", role: "stored-data", detail: "passage embeddings", lane: "data" },
    { id: "docs", label: "Documents", role: "database", detail: "source content", lane: "data" },
  ],
  edges: [
    { id: "r1", from: "user", to: "api", semantics: "request", important: true },
    { id: "r2", from: "api", to: "embed", semantics: "request", important: true },
    { id: "r3", from: "embed", to: "retrieve", semantics: "request", important: true },
    { id: "r4", from: "retrieve", to: "vectors", semantics: "data", important: true },
    { id: "r5", from: "retrieve", to: "rerank", semantics: "request", important: true },
    { id: "r6", from: "rerank", to: "model", semantics: "request", important: true },
    { id: "r7", from: "model", to: "guard", semantics: "request", important: true },
    { id: "r8", from: "guard", to: "api", semantics: "success", important: true, label: "cited" },
    { id: "r9", from: "guard", to: "retrieve", semantics: "feedback", important: false, label: "retry wider" },
    { id: "r10", from: "docs", to: "ingest", semantics: "data", important: false },
    { id: "r11", from: "ingest", to: "vectors", semantics: "data", important: false },
  ],
};

export const cicdTemplate: DiagramPlan = {
  id: "template-cicd",
  mode: "data-pipeline",
  title: "CI/CD pipeline",
  purpose: "From a pushed commit to a verified production release.",
  nodes: [
    { id: "push", label: "Push", role: "actor", detail: "commit to main", lane: "entry" },
    { id: "build", label: "Build", role: "process", detail: "compile and package", lane: "core" },
    { id: "test", label: "Test", role: "process", detail: "unit and integration", lane: "core" },
    { id: "gate", label: "All green?", role: "decision", detail: "block on failure", lane: "core" },
    { id: "staging", label: "Deploy staging", role: "process", detail: "smoke tests", lane: "core" },
    { id: "approve", label: "Approve", role: "manual-input", detail: "release owner", lane: "core" },
    { id: "prod", label: "Deploy production", role: "process", detail: "rolling update", technology: "kubernetes", lane: "core" },
    { id: "watch", label: "Watch", role: "service", detail: "error rate and latency", technology: "prometheus", lane: "async" },
    { id: "rollback", label: "Roll back", role: "worker", detail: "previous revision", lane: "async" },
    { id: "registry", label: "Artifact registry", role: "stored-data", detail: "images", technology: "docker", lane: "data" },
  ],
  edges: [
    { id: "p1", from: "push", to: "build", semantics: "request", important: true },
    { id: "p2", from: "build", to: "registry", semantics: "data", important: true },
    { id: "p3", from: "build", to: "test", semantics: "request", important: true },
    { id: "p4", from: "test", to: "gate", semantics: "request", important: true },
    { id: "p5", from: "gate", to: "staging", semantics: "success", important: true, label: "yes" },
    { id: "p6", from: "gate", to: "push", semantics: "failure", important: false, label: "no" },
    { id: "p7", from: "staging", to: "approve", semantics: "request", important: true },
    { id: "p8", from: "approve", to: "prod", semantics: "request", important: true },
    { id: "p9", from: "prod", to: "watch", semantics: "event", important: false },
    { id: "p10", from: "watch", to: "rollback", semantics: "failure", important: false, label: "regression" },
  ],
};

export const serverlessTemplate: DiagramPlan = {
  id: "template-serverless",
  mode: "infrastructure",
  title: "Serverless API",
  purpose: "Managed edge, functions and a key-value store — nothing to run.",
  nodes: [
    { id: "client", label: "Client", role: "actor", detail: "web and mobile", lane: "entry" },
    { id: "cdn", label: "CDN", role: "gateway", detail: "static and cache", technology: "cloudflare", lane: "entry" },
    { id: "apigw", label: "API Gateway", role: "gateway", detail: "routes and throttles", technology: "aws-lambda", lane: "core" },
    { id: "fn-read", label: "Read function", role: "service", detail: "query handler", technology: "aws-lambda", lane: "core" },
    { id: "fn-write", label: "Write function", role: "service", detail: "command handler", technology: "aws-lambda", lane: "core" },
    { id: "queue", label: "Queue", role: "event-bus", detail: "buffers spikes", technology: "aws-sqs", lane: "async" },
    { id: "worker", label: "Async worker", role: "worker", detail: "slow work off the request", technology: "aws-lambda", lane: "async" },
    { id: "table", label: "Table", role: "database", detail: "single-table design", technology: "aws-dynamodb", lane: "data" },
    { id: "bucket", label: "Object store", role: "stored-data", detail: "uploads and exports", technology: "aws-s3", lane: "data" },
  ],
  edges: [
    { id: "s1", from: "client", to: "cdn", semantics: "request", important: true },
    { id: "s2", from: "cdn", to: "apigw", semantics: "request", important: true, label: "miss" },
    { id: "s3", from: "apigw", to: "fn-read", semantics: "request", important: true },
    { id: "s4", from: "apigw", to: "fn-write", semantics: "request", important: false },
    { id: "s5", from: "fn-read", to: "table", semantics: "data", important: true },
    { id: "s6", from: "fn-write", to: "table", semantics: "data", important: false },
    { id: "s7", from: "fn-write", to: "queue", semantics: "event", important: false },
    { id: "s8", from: "queue", to: "worker", semantics: "event", important: false },
    { id: "s9", from: "worker", to: "bucket", semantics: "data", important: false },
  ],
};

export const oauthTemplate: DiagramPlan = {
  id: "template-oauth",
  mode: "flow",
  title: "OAuth 2.0 authorization code",
  purpose: "How a browser trades a code for tokens, with PKCE.",
  nodes: [
    { id: "start", label: "Sign in pressed", role: "start", detail: "", lane: "entry" },
    { id: "verifier", label: "Create PKCE verifier", role: "process", detail: "and its challenge", lane: "core" },
    { id: "redirect", label: "Redirect to provider", role: "process", detail: "with the challenge", lane: "core" },
    { id: "consent", label: "User approves?", role: "decision", detail: "consent screen", lane: "core" },
    { id: "denied", label: "Return to sign in", role: "input-output", detail: "access denied", lane: "core" },
    { id: "code", label: "Receive code", role: "input-output", detail: "on the redirect URI", lane: "core" },
    { id: "exchange", label: "Exchange code", role: "process", detail: "code plus verifier", lane: "core" },
    { id: "valid", label: "Verifier matches?", role: "decision", detail: "provider checks", lane: "core" },
    { id: "tokens", label: "Store tokens", role: "process", detail: "access and refresh", lane: "core" },
    { id: "done", label: "Signed in", role: "end", detail: "", lane: "core" },
    { id: "fail", label: "Sign-in failed", role: "end", detail: "", lane: "core" },
  ],
  edges: [
    { id: "o1", from: "start", to: "verifier", semantics: "request", important: true },
    { id: "o2", from: "verifier", to: "redirect", semantics: "request", important: true },
    { id: "o3", from: "redirect", to: "consent", semantics: "request", important: true },
    { id: "o4", from: "consent", to: "code", semantics: "success", important: true, label: "yes" },
    { id: "o5", from: "consent", to: "denied", semantics: "failure", important: false, label: "no" },
    { id: "o6", from: "denied", to: "fail", semantics: "request", important: false },
    { id: "o7", from: "code", to: "exchange", semantics: "request", important: true },
    { id: "o8", from: "exchange", to: "valid", semantics: "request", important: true },
    { id: "o9", from: "valid", to: "tokens", semantics: "success", important: true, label: "yes" },
    { id: "o10", from: "valid", to: "fail", semantics: "failure", important: false, label: "no" },
    { id: "o11", from: "tokens", to: "done", semantics: "request", important: true },
  ],
};

export const cachingTemplate: DiagramPlan = {
  id: "template-caching",
  mode: "architecture",
  title: "Caching layers",
  purpose: "Where a read is answered, and what happens on a miss.",
  nodes: [
    { id: "browser", label: "Browser", role: "actor", detail: "HTTP cache", lane: "entry" },
    { id: "cdn", label: "CDN", role: "gateway", detail: "edge cache", technology: "cloudflare", lane: "entry" },
    { id: "app", label: "Application", role: "service", detail: "request handler", lane: "core" },
    { id: "memo", label: "In-process cache", role: "cache", detail: "per instance, short TTL", lane: "core" },
    { id: "shared", label: "Shared cache", role: "cache", detail: "cross-instance", technology: "redis", lane: "core" },
    { id: "invalidate", label: "Invalidator", role: "worker", detail: "on write, evict keys", lane: "async" },
    { id: "db", label: "Database", role: "database", detail: "system of record", technology: "postgresql", lane: "data" },
  ],
  edges: [
    { id: "k1", from: "browser", to: "cdn", semantics: "request", important: true },
    { id: "k2", from: "cdn", to: "app", semantics: "request", important: true, label: "miss" },
    { id: "k3", from: "app", to: "memo", semantics: "data", important: true },
    { id: "k4", from: "app", to: "shared", semantics: "data", important: true, label: "miss" },
    { id: "k5", from: "app", to: "db", semantics: "data", important: true, label: "miss" },
    { id: "k6", from: "app", to: "invalidate", semantics: "event", important: false, label: "on write" },
    { id: "k7", from: "invalidate", to: "shared", semantics: "data", important: false, label: "evict" },
  ],
};

export const webhookTemplate: DiagramPlan = {
  id: "template-webhooks",
  mode: "event-driven",
  title: "Webhook delivery with retries",
  purpose: "Deliver once, retry with backoff, and give up somewhere visible.",
  nodes: [
    { id: "source", label: "Domain event", role: "actor", detail: "something happened", lane: "entry" },
    { id: "outbox", label: "Outbox", role: "process", detail: "written in the same transaction", lane: "core" },
    { id: "dispatch", label: "Dispatcher", role: "service", detail: "signs and sends", lane: "core" },
    { id: "customer", label: "Customer endpoint", role: "gateway", detail: "their server", lane: "core" },
    { id: "ok", label: "2xx?", role: "decision", detail: "delivery accepted", lane: "core" },
    { id: "retry", label: "Retry queue", role: "event-bus", detail: "exponential backoff", lane: "async" },
    { id: "dead", label: "Dead letter", role: "worker", detail: "alert and inspect", lane: "async" },
    { id: "log", label: "Delivery log", role: "stored-data", detail: "attempts and responses", lane: "data" },
  ],
  edges: [
    { id: "w1", from: "source", to: "outbox", semantics: "event", important: true },
    { id: "w2", from: "outbox", to: "dispatch", semantics: "request", important: true },
    { id: "w3", from: "dispatch", to: "customer", semantics: "request", important: true },
    { id: "w4", from: "customer", to: "ok", semantics: "request", important: true },
    { id: "w5", from: "ok", to: "log", semantics: "data", important: true, label: "yes" },
    { id: "w6", from: "ok", to: "retry", semantics: "failure", important: false, label: "no" },
    { id: "w7", from: "retry", to: "dispatch", semantics: "feedback", important: false, label: "backoff" },
    { id: "w8", from: "retry", to: "dead", semantics: "failure", important: false, label: "gave up" },
  ],
};

export const observabilityTemplate: DiagramPlan = {
  id: "template-observability",
  mode: "infrastructure",
  title: "Observability stack",
  purpose: "Where metrics, logs and traces come from, and who gets paged.",
  nodes: [
    { id: "service", label: "Services", role: "service", detail: "instrumented", lane: "entry" },
    { id: "agent", label: "Collector", role: "gateway", detail: "OpenTelemetry", lane: "core" },
    { id: "metrics", label: "Metrics", role: "service", detail: "counters and histograms", technology: "prometheus", lane: "core" },
    { id: "logs", label: "Logs", role: "service", detail: "structured events", technology: "elasticsearch", lane: "core" },
    { id: "traces", label: "Traces", role: "service", detail: "request spans", lane: "core" },
    { id: "alerts", label: "Alerting", role: "worker", detail: "rules and routing", lane: "async" },
    { id: "oncall", label: "On-call", role: "actor", detail: "pager", lane: "async" },
    { id: "dash", label: "Dashboards", role: "document", detail: "what to look at first", technology: "grafana", lane: "async" },
    { id: "tsdb", label: "Time series", role: "stored-data", detail: "retention windows", lane: "data" },
    { id: "logstore", label: "Log store", role: "stored-data", detail: "searchable", lane: "data" },
    { id: "tracestore", label: "Trace store", role: "stored-data", detail: "sampled", lane: "data" },
  ],
  edges: [
    { id: "b1", from: "service", to: "agent", semantics: "event", important: true },
    { id: "b2", from: "agent", to: "metrics", semantics: "data", important: true },
    { id: "b3", from: "agent", to: "logs", semantics: "data", important: false },
    { id: "b4", from: "agent", to: "traces", semantics: "data", important: false },
    { id: "b5", from: "metrics", to: "tsdb", semantics: "data", important: true },
    { id: "b6", from: "logs", to: "logstore", semantics: "data", important: false },
    { id: "b7", from: "traces", to: "tracestore", semantics: "data", important: false },
    { id: "b8", from: "metrics", to: "alerts", semantics: "event", important: true },
    { id: "b9", from: "alerts", to: "oncall", semantics: "event", important: true, label: "page" },
    { id: "b10", from: "logs", to: "dash", semantics: "data", important: false },
  ],
};

export const multiRegionTemplate: DiagramPlan = {
  id: "template-multi-region",
  mode: "infrastructure",
  title: "Multi-region active-passive",
  purpose: "Where traffic goes, and what happens when a region is lost.",
  nodes: [
    { id: "user", label: "Users", role: "actor", detail: "worldwide", lane: "entry" },
    { id: "dns", label: "Global DNS", role: "gateway", detail: "health-checked routing", technology: "cloudflare", lane: "entry" },
    { id: "primary", label: "Primary region", role: "zone", detail: "serves all writes", lane: "core" },
    { id: "papp", label: "App tier", role: "service", detail: "autoscaled", technology: "kubernetes", lane: "core" },
    { id: "pdb", label: "Primary DB", role: "database", detail: "writes", technology: "postgresql", lane: "data" },
    { id: "secondary", label: "Standby region", role: "zone", detail: "warm", lane: "core" },
    { id: "sapp", label: "App tier (idle)", role: "service", detail: "scaled to minimum", technology: "kubernetes", lane: "core" },
    { id: "sdb", label: "Replica DB", role: "database", detail: "streaming replication", technology: "postgresql", lane: "data" },
    { id: "failover", label: "Failover", role: "worker", detail: "promote the replica", lane: "async" },
  ],
  edges: [
    { id: "g1", from: "user", to: "dns", semantics: "request", important: true },
    { id: "g2", from: "dns", to: "papp", semantics: "request", important: true, label: "healthy" },
    { id: "g3", from: "papp", to: "pdb", semantics: "data", important: true },
    { id: "g4", from: "pdb", to: "sdb", semantics: "data", important: true, label: "replicate" },
    { id: "g5", from: "dns", to: "sapp", semantics: "failure", important: false, label: "primary down" },
    { id: "g6", from: "sapp", to: "sdb", semantics: "data", important: false },
    { id: "g7", from: "failover", to: "sdb", semantics: "event", important: false, label: "promote" },
  ],
};

export const architectureTemplates = [
  microservicesTemplate,
  cqrsTemplate,
  ragTemplate,
  cicdTemplate,
  serverlessTemplate,
  oauthTemplate,
  cachingTemplate,
  webhookTemplate,
  observabilityTemplate,
  multiRegionTemplate,
];
