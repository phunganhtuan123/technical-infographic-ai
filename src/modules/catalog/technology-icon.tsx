import {
  siApachecassandra, siApachekafka, siApachepulsar, siAuth0, siCloudflare,
  siCockroachlabs, siDatadog, siDocker, siDotnet, siElasticsearch, siFirebase,
  siGo, siGooglebigquery, siGooglecloud, siGooglecloudstorage, siGrafana,
  siGraphql, siKeycloak, siKubernetes, siMariadb, siMongodb, siMysql, siNginx,
  siNodedotjs, siOpenid, siOpenjdk, siPostgresql, siPrisma, siPrometheus,
  siPython, siRabbitmq, siRedis, siRust, siSpringboot, siSqlite, siSupabase,
  siTerraform, siTypescript, type SimpleIcon,
} from "simple-icons";
import { useSyncExternalStore } from "react";
import { brandIconsSnapshot, ensureBrandIcons, subscribeBrandIcons, technologyDetails, type TechnologyId } from "./catalog";

type TechnologyIconProps = {
  technology?: string;
  provider?: string;
  compact?: boolean;
};

function Glyph({ glyph, badge }: { glyph: string; badge: string }) {
  if (glyph === "database") return <><ellipse cx="12" cy="7" rx="7" ry="3" /><path d="M5 7v9c0 1.7 3.1 3 7 3s7-1.3 7-3V7M5 11c0 1.7 3.1 3 7 3s7-1.3 7-3" /></>;
  if (glyph === "stack") return <><path d="m12 4 8 4-8 4-8-4 8-4Z" /><path d="m5 12 7 3.5 7-3.5M5 16l7 3.5 7-3.5" /></>;
  if (glyph === "network") return <><circle cx="12" cy="5" r="2" /><circle cx="6" cy="17" r="2" /><circle cx="18" cy="17" r="2" /><path d="m11 7-4 8M13 7l4 8M8 17h8" /></>;
  if (glyph === "cluster") return <><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="2" /><path d="M12 3v5M12 16v5M3 12h5M16 12h5M5.6 5.6l3.5 3.5M14.9 14.9l3.5 3.5M18.4 5.6l-3.5 3.5M9.1 14.9l-3.5 3.5" /></>;
  if (glyph === "blocks") return <><rect x="4" y="8" width="5" height="5" /><rect x="10" y="8" width="5" height="5" /><rect x="10" y="2" width="5" height="5" /><rect x="16" y="8" width="5" height="5" /><path d="M3 15c2 4 6 6 10 6 4.5 0 7-2.2 8-5" /></>;
  if (glyph === "cloud") return <path d="M7 18h11a4 4 0 0 0 .6-8A6.5 6.5 0 0 0 6 11.5 3.3 3.3 0 0 0 7 18Z" />;
  if (glyph === "leaf") return <><path d="M19 4C10 5 5 10 6 18c7 1 12-4 13-14Z" /><path d="M7 18c3-4 6-7 10-10" /></>;
  if (glyph === "shield") return <><path d="M12 3 20 6v5c0 5-3 8-8 10-5-2-8-5-8-10V6l8-3Z" /><circle cx="12" cy="11" r="2" /><path d="M12 13v4" /></>;
  if (glyph === "queue") return <><rect x="4" y="5" width="16" height="4" rx="2" /><rect x="4" y="11" width="16" height="4" rx="2" /><path d="M8 19h8M12 15v4" /></>;
  if (glyph === "function") return <><path d="M15 4h-2c-2 0-3 1.3-3.5 3L7 17c-.5 2-1.5 3-3.5 3H2" /><path d="M6 11h7M15 11l6 6M21 11l-6 6" /></>;
  if (glyph === "bucket") return <><path d="M5 7h14l-1 12H6L5 7Z" /><path d="M8 7a4 4 0 0 1 8 0" /></>;
  if (glyph === "search") return <><circle cx="10" cy="10" r="6" /><path d="m15 15 5 5M10 7v6M7 10h6" /></>;
  if (glyph === "flame") return <path d="M13 3c1 5-4 6-2 10 1-2 3-3 5-3 2 2 3 4 2 7-1 3-4 4-7 4-4 0-7-3-7-7 0-5 4-7 9-11Z" />;
  if (glyph === "bolt") return <path d="m13 2-8 12h6l-1 8 9-13h-6V2Z" />;
  if (glyph === "gateway") return <><path d="M5 19V5h14v14M2 12h8M14 12h8" /><path d="m7 9 3 3-3 3M17 9l-3 3 3 3" /></>;
  if (glyph === "metric") return <><path d="M4 19V5M4 19h16" /><path d="m7 15 4-5 3 3 5-7" /></>;
  return <text x="12" y="15" textAnchor="middle">{badge}</text>;
}

const brandIcons: Partial<Record<TechnologyId, SimpleIcon>> = {
  postgresql: siPostgresql, mysql: siMysql, mariadb: siMariadb, sqlite: siSqlite,
  mongodb: siMongodb, cassandra: siApachecassandra, cockroachdb: siCockroachlabs,
  elasticsearch: siElasticsearch, prisma: siPrisma, redis: siRedis,
  kafka: siApachekafka, rabbitmq: siRabbitmq, pulsar: siApachepulsar,
  kubernetes: siKubernetes, docker: siDocker, "gcp-pubsub": siGooglecloud,
  "gcp-functions": siGooglecloud, "gcp-storage": siGooglecloudstorage,
  "gcp-bigquery": siGooglebigquery, firebase: siFirebase, supabase: siSupabase,
  typescript: siTypescript, python: siPython, go: siGo, java: siOpenjdk,
  nodejs: siNodedotjs, rust: siRust, dotnet: siDotnet, "spring-boot": siSpringboot,
  graphql: siGraphql, oauth: siOpenid, auth0: siAuth0, keycloak: siKeycloak,
  nginx: siNginx, terraform: siTerraform, cloudflare: siCloudflare,
  prometheus: siPrometheus, grafana: siGrafana, datadog: siDatadog,
};

export function TechnologyIcon({ technology, provider, compact = false }: TechnologyIconProps) {
  const details = technologyDetails(technology);
  // Anything outside the curated catalog is looked up by simple-icons slug. The
  // index arrives asynchronously, so subscribe rather than read once.
  const index = useSyncExternalStore(subscribeBrandIcons, brandIconsSnapshot, () => undefined);
  const needsIndex = Boolean(technology) && !details;
  if (needsIndex && !index) void ensureBrandIcons();
  const dynamicIcon = needsIndex ? index?.get(technology!) : undefined;

  const label = details?.label ?? dynamicIcon?.title ?? provider;
  const badge = details?.badge ?? dynamicIcon?.title.slice(0, 2).toUpperCase() ?? provider?.toUpperCase().slice(0, 3);
  if (!badge) return null;
  const glyph = details?.glyph ?? "letters";
  const brandIcon = details ? brandIcons[technology as TechnologyId] : undefined;
  const path = brandIcon?.path ?? dynamicIcon?.path;
  const color = details?.color ?? (dynamicIcon ? `#${dynamicIcon.hex}` : "var(--node-color)");

  return (
    <span
      aria-label={label}
      className={`technology-mark${compact ? " is-compact" : ""}`}
      style={{ "--technology-color": color } as React.CSSProperties}
      title={label}
    >
      <svg aria-hidden="true" className={path ? "is-brand" : undefined} viewBox="0 0 24 24">
        {path ? <path d={path} /> : <Glyph badge={badge} glyph={glyph} />}
      </svg>
    </span>
  );
}
