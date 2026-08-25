import type { DiagramPlan } from "@/modules/diagram/schema";

export const architecturePlan: DiagramPlan = {
  id: "marketplace-architecture",
  mode: "architecture",
  title: "Marketplace payment architecture",
  purpose: "A synchronous request path hands completed payments to asynchronous workers.",
  nodes: [
    { id: "web", label: "Web App", role: "actor", detail: "customer entry", lane: "entry" },
    { id: "gateway", label: "API Gateway", role: "gateway", detail: "request boundary", lane: "core" },
    { id: "market", label: "Marketplace", role: "service", detail: "order context", lane: "core" },
    { id: "policy", label: "Policy Service", role: "service", detail: "policy issuance", lane: "core" },
    { id: "payment", label: "Payment Service", role: "service", detail: "payment lifecycle", lane: "core" },
    { id: "events", label: "Event Bus", role: "event-bus", technology: "kafka", detail: "async fan-out", lane: "async" },
    { id: "policy-worker", label: "Policy Worker", role: "worker", detail: "event consumer", lane: "async" },
    { id: "notify-worker", label: "Notification Worker", role: "worker", detail: "event consumer", lane: "async" },
    { id: "market-db", label: "Marketplace DB", role: "database", technology: "postgresql", lane: "data" },
    { id: "policy-db", label: "Policy DB", role: "database", technology: "postgresql", lane: "data" },
    { id: "payment-db", label: "Payment DB", role: "database", technology: "postgresql", lane: "data" },
    { id: "cache", label: "Shared Cache", role: "cache", technology: "redis", detail: "hot reads", lane: "data" },
  ],
  edges: [
    { id: "web-gateway", from: "web", to: "gateway", semantics: "request", important: true },
    { id: "gateway-market", from: "gateway", to: "market", semantics: "request", important: true },
    { id: "market-policy", from: "market", to: "policy", semantics: "request", important: true },
    { id: "policy-payment", from: "policy", to: "payment", semantics: "request", important: true },
    { id: "payment-event", from: "payment", to: "events", semantics: "event", label: "PaymentCompleted", important: true },
    { id: "event-policy", from: "events", to: "policy-worker", semantics: "event", important: true },
    { id: "event-notify", from: "events", to: "notify-worker", semantics: "event", important: false },
    { id: "market-data", from: "market", to: "market-db", semantics: "data", important: false },
    { id: "policy-data", from: "policy", to: "policy-db", semantics: "data", important: false },
    { id: "payment-data", from: "payment", to: "payment-db", semantics: "data", important: false },
  ],
};
