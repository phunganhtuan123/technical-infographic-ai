import type { NodeRole } from "@/modules/diagram/schema";

export const roleColors: Record<NodeRole, string> = {
  actor: "#f5f5f5",
  gateway: "#60a5fa",
  service: "#63e6ff",
  "event-bus": "#fbbf24",
  worker: "#fbbf24",
  database: "#a78bfa",
  cache: "#fb923c",
  agent: "#b6ff5c",
  tool: "#63e6ff",
  model: "#a78bfa",
  start: "#b6ff5c",
  process: "#63e6ff",
  decision: "#fbbf24",
  "input-output": "#a78bfa",
  end: "#fb7185",
  document: "#f5f5f5",
  subprocess: "#63e6ff",
  "manual-input": "#a78bfa",
  preparation: "#fbbf24",
  delay: "#60a5fa",
  connector: "#b6ff5c",
  "off-page": "#fb7185",
  merge: "#fbbf24",
  "stored-data": "#a78bfa",
  zone: "#60a5fa",
  group: "#a78bfa",
  text: "#f5f5f5",
  note: "#fbbf24",
};

export const technologyCatalog = {
  postgresql: { label: "PostgreSQL", category: "database", badge: "PG", color: "#60a5fa", glyph: "database" },
  mysql: { label: "MySQL", category: "database", badge: "MY", color: "#38bdf8", glyph: "database" },
  mariadb: { label: "MariaDB", category: "database", badge: "MA", color: "#c49a6c", glyph: "database" },
  sqlite: { label: "SQLite", category: "database", badge: "SQ", color: "#60a5fa", glyph: "database" },
  mongodb: { label: "MongoDB", category: "database", badge: "MO", color: "#4ade80", glyph: "leaf" },
  cassandra: { label: "Apache Cassandra", category: "database", badge: "CA", color: "#38bdf8", glyph: "database" },
  cockroachdb: { label: "CockroachDB", category: "database", badge: "CR", color: "#86efac", glyph: "database" },
  elasticsearch: { label: "Elasticsearch", category: "database", badge: "ES", color: "#fbbf24", glyph: "search" },
  prisma: { label: "Prisma", category: "database", badge: "PR", color: "#a5b4fc", glyph: "database" },
  redis: { label: "Redis", category: "cache", badge: "RD", color: "#fb7185", glyph: "stack" },
  kafka: { label: "Kafka", category: "messaging", badge: "KF", color: "#e5e7eb", glyph: "network" },
  rabbitmq: { label: "RabbitMQ", category: "messaging", badge: "MQ", color: "#fb923c", glyph: "queue" },
  pulsar: { label: "Apache Pulsar", category: "messaging", badge: "PS", color: "#f5f5f5", glyph: "queue" },
  kubernetes: { label: "Kubernetes", category: "compute", badge: "K8s", color: "#60a5fa", glyph: "cluster" },
  docker: { label: "Docker", category: "compute", badge: "DK", color: "#38bdf8", glyph: "blocks" },
  "aws-sqs": { label: "Amazon SQS", category: "messaging", badge: "AWS", color: "#fbbf24", glyph: "cloud" },
  "aws-lambda": { label: "AWS Lambda", category: "compute", badge: "λ", color: "#fb923c", glyph: "function" },
  "aws-dynamodb": { label: "Amazon DynamoDB", category: "database", badge: "DDB", color: "#60a5fa", glyph: "database" },
  "aws-rds": { label: "Amazon RDS", category: "database", badge: "RDS", color: "#60a5fa", glyph: "database" },
  "aws-s3": { label: "Amazon S3", category: "storage", badge: "S3", color: "#4ade80", glyph: "bucket" },
  "gcp-pubsub": { label: "Google Pub/Sub", category: "messaging", badge: "GCP", color: "#60a5fa", glyph: "cloud" },
  "gcp-functions": { label: "Cloud Functions", category: "compute", badge: "GCF", color: "#60a5fa", glyph: "function" },
  "gcp-storage": { label: "Cloud Storage", category: "storage", badge: "GCS", color: "#60a5fa", glyph: "bucket" },
  "gcp-bigquery": { label: "BigQuery", category: "analytics", badge: "BQ", color: "#60a5fa", glyph: "search" },
  firebase: { label: "Firebase", category: "platform", badge: "FB", color: "#fbbf24", glyph: "flame" },
  supabase: { label: "Supabase", category: "platform", badge: "SB", color: "#4ade80", glyph: "bolt" },
  typescript: { label: "TypeScript", category: "language", badge: "TS", color: "#60a5fa", glyph: "letters" },
  python: { label: "Python", category: "language", badge: "PY", color: "#facc15", glyph: "letters" },
  go: { label: "Go", category: "language", badge: "GO", color: "#22d3ee", glyph: "letters" },
  java: { label: "Java", category: "language", badge: "JV", color: "#fb923c", glyph: "letters" },
  nodejs: { label: "Node.js", category: "runtime", badge: "JS", color: "#86efac", glyph: "letters" },
  rust: { label: "Rust", category: "language", badge: "RS", color: "#e5e7eb", glyph: "letters" },
  dotnet: { label: ".NET", category: "runtime", badge: ".N", color: "#a78bfa", glyph: "letters" },
  "spring-boot": { label: "Spring Boot", category: "runtime", badge: "SP", color: "#86efac", glyph: "leaf" },
  graphql: { label: "GraphQL", category: "api", badge: "GQ", color: "#f472b6", glyph: "network" },
  oauth: { label: "OAuth / OIDC", category: "auth", badge: "ID", color: "#a78bfa", glyph: "shield" },
  auth0: { label: "Auth0", category: "auth", badge: "A0", color: "#fb923c", glyph: "shield" },
  keycloak: { label: "Keycloak", category: "auth", badge: "KC", color: "#60a5fa", glyph: "shield" },
  nginx: { label: "NGINX", category: "network", badge: "NG", color: "#4ade80", glyph: "gateway" },
  terraform: { label: "Terraform", category: "infrastructure", badge: "TF", color: "#a78bfa", glyph: "blocks" },
  cloudflare: { label: "Cloudflare", category: "network", badge: "CF", color: "#fb923c", glyph: "cloud" },
  prometheus: { label: "Prometheus", category: "observability", badge: "PM", color: "#fb923c", glyph: "metric" },
  grafana: { label: "Grafana", category: "observability", badge: "GF", color: "#fb923c", glyph: "metric" },
  datadog: { label: "Datadog", category: "observability", badge: "DD", color: "#a78bfa", glyph: "metric" },
} as const;

export type TechnologyId = keyof typeof technologyCatalog;

export const technologyOptions = Object.entries(technologyCatalog).map(([id, technology]) => ({
  id: id as TechnologyId,
  ...technology,
}));

export function technologyDetails(technology?: string) {
  return technology && technology in technologyCatalog
    ? technologyCatalog[technology as TechnologyId]
    : undefined;
}

export function technologyBadge(technology?: string, provider?: string) {
  const details = technologyDetails(technology);
  if (details) return details.badge;
  return provider?.toUpperCase().slice(0, 4);
}
