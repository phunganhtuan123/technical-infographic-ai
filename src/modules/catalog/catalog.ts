import type { EdgeSemantics, NodeRole } from "@/modules/diagram/schema";

/**
 * Node colours, tuned for the light canvas.
 *
 * A node mixes this colour into white at about 8% for its fill and 24% for its
 * border, so what is stored here is the ink, not the fill: it has to stay
 * legible as the role label and the outline, which the old neon palette stopped
 * doing the moment the background was no longer black.
 *
 * The flowchart roles carry the house convention: start and end are green, a
 * decision is orange (and a diamond, via flowShapes), a process — the
 * computation step — is blue, and input-output — where a result leaves the
 * flow — is violet.
 */
export const roleColors: Record<NodeRole, string> = {
  actor: "#475569",
  gateway: "#2563eb",
  service: "#0891b2",
  "event-bus": "#d97706",
  worker: "#c2410c",
  database: "#7c3aed",
  cache: "#ea580c",
  agent: "#4d7c0f",
  tool: "#0891b2",
  model: "#7c3aed",
  start: "#16a34a",
  process: "#3b82f6",
  decision: "#ea580c",
  "input-output": "#9333ea",
  end: "#16a34a",
  document: "#64748b",
  subprocess: "#3b82f6",
  "manual-input": "#8b5cf6",
  preparation: "#d97706",
  delay: "#2563eb",
  connector: "#16a34a",
  "off-page": "#e11d48",
  merge: "#d97706",
  "stored-data": "#7c3aed",
  zone: "#2563eb",
  group: "#7c3aed",
  text: "#334155",
  note: "#d97706",
};

/**
 * Edge colours by meaning. This table was written out at four call sites and
 * had already drifted between them; keeping it in one place is what stops the
 * canvas, the compiler and an AI plan disagreeing about a failure edge.
 */
export const edgeColors: Record<EdgeSemantics, string> = {
  request: "#475569",
  event: "#d97706",
  data: "#7c3aed",
  feedback: "#7c3aed",
  success: "#16a34a",
  failure: "#e11d48",
};

export function edgeColor(semantics: EdgeSemantics | undefined) {
  return edgeColors[semantics ?? "request"] ?? edgeColors.request;
}

/** Canvas theme baked into exported documents. */
export const diagramTheme = { background: "#fdfdfe", accent: "#4d7c0f" } as const;

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

// ---------------------------------------------------------------------------
// Brand icons beyond the curated set.
//
// The 44 entries above are curated: they carry a category, a fallback glyph and
// a lane, and they are what the component library offers as draggable
// primitives. Everything else simple-icons ships (3,400+ marks) is reachable by
// slug from the Inspector's icon search. That whole set is ~5 MB of path data,
// so it is imported dynamically and only the first time something asks for it.
// ---------------------------------------------------------------------------

export type BrandIcon = { title: string; slug: string; hex: string; path: string };

let brandIndex: Map<string, BrandIcon> | undefined;
let brandRequest: Promise<Map<string, BrandIcon>> | undefined;
const brandListeners = new Set<() => void>();

export function subscribeBrandIcons(listener: () => void) {
  brandListeners.add(listener);
  return () => {
    brandListeners.delete(listener);
  };
}

export function brandIconsSnapshot() {
  return brandIndex;
}

export function ensureBrandIcons() {
  if (brandIndex) return Promise.resolve(brandIndex);
  brandRequest ??= import("simple-icons").then((module) => {
    const index = new Map<string, BrandIcon>();
    for (const value of Object.values(module) as Array<Partial<BrandIcon>>) {
      if (value && typeof value.slug === "string" && typeof value.path === "string") {
        index.set(value.slug, value as BrandIcon);
      }
    }
    brandIndex = index;
    for (const listener of brandListeners) listener();
    return index;
  });
  return brandRequest;
}

export function searchBrandIcons(query: string, limit = 60) {
  const trimmed = query.trim().toLowerCase();
  if (!brandIndex || trimmed.length < 2) return [];
  const starts: BrandIcon[] = [];
  const contains: BrandIcon[] = [];
  for (const icon of brandIndex.values()) {
    const title = icon.title.toLowerCase();
    if (title.startsWith(trimmed) || icon.slug.startsWith(trimmed)) starts.push(icon);
    else if (title.includes(trimmed) || icon.slug.includes(trimmed)) contains.push(icon);
    if (starts.length >= limit) break;
  }
  return [...starts, ...contains].slice(0, limit);
}

/**
 * The dark-only palette this editor shipped before the light canvas.
 *
 * Those values are neon: they were chosen to glow on near-black, and a node
 * paints its fill by mixing its colour into the sheet at 8% and its border at
 * 24%. Mixed into white instead, neon lime and cyan land close enough to the
 * sheet that the node all but disappears — which is exactly what happens to a
 * diagram saved by the old build and reopened on the light canvas.
 *
 * So a stored colour that matches one of these is treated as "the default for
 * this role at the time", not as a decision, and is remapped. A colour the
 * author actually picked is never touched.
 */
const legacyPalette: Record<string, string> = {
  "#f5f5f5": "#475569",
  "#63e6ff": "#0891b2",
  "#b6ff5c": "#4d7c0f",
  "#a78bfa": "#7c3aed",
  "#fbbf24": "#d97706",
  "#fb923c": "#ea580c",
  "#fb7185": "#e11d48",
  "#60a5fa": "#2563eb",
};

/**
 * The colour to draw a node in, given what the document stored.
 *
 * A legacy default resolves to the current palette entry for that role, so an
 * old start node comes back green rather than as the near-invisible lime it was
 * saved as. Where the role is unknown the hue is mapped on its own.
 */
export function resolveNodeColor(color: string | undefined, role?: NodeRole) {
  if (!color) return role ? roleColors[role] : legacyPalette["#f5f5f5"];
  const key = color.toLowerCase();
  if (!(key in legacyPalette)) return color;
  return role ? roleColors[role] : legacyPalette[key];
}

/** The same rule for a connector, whose default came from its semantics. */
export function resolveEdgeColor(color: string | undefined, semantics: EdgeSemantics | undefined) {
  if (!color) return edgeColor(semantics);
  const key = color.toLowerCase();
  return key in legacyPalette ? edgeColor(semantics) : color;
}

/**
 * Default node text. The canvas is light, so ink is dark.
 *
 * `legacyNodeInk` is the near-white this used to be. It is still written into
 * every document saved before the light canvas, and treating it as "unset"
 * rather than as a real choice is what keeps those diagrams readable instead of
 * white-on-white. Anything else the user actually picked is honoured.
 */
export const nodeInk = "#0f172a";
export const legacyNodeInk = "#f5f5f5";

export function resolveNodeInk(textColor: string | undefined, fallback = nodeInk) {
  if (!textColor) return fallback;
  // Both defaults — the near-white this shipped with and the dark ink that
  // replaced it — mean "no choice was made", so they defer to the theme. Only
  // then does a light document stay readable after a switch to dark, and the
  // other way round.
  const key = textColor.toLowerCase();
  return key === legacyNodeInk || key === nodeInk ? fallback : textColor;
}

/** Readable ink for arbitrary artwork backgrounds, used by the SVG export. */
export function inkFor(background: string) {
  const dark = { strong: "#f5f5f5", muted: "#888888" };
  const light = { strong: nodeInk, muted: "#64748b" };
  const hex = background.replace("#", "");
  if (hex.length < 6) return light;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.5 ? light : dark;
}
