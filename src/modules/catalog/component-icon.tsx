import type { NodeRole } from "@/modules/diagram/schema";

export function ComponentIcon({ role, compact = false }: { role: NodeRole; compact?: boolean }) {
  return (
    <span className={`component-mark${compact ? " is-compact" : ""}`} aria-hidden="true">
      <svg viewBox="0 0 24 24">
        {role === "actor" ? <><circle cx="12" cy="7" r="3" /><path d="M5 20c.6-5 3-7 7-7s6.4 2 7 7" /></> : null}
        {role === "gateway" ? <><path d="m12 3 9 9-9 9-9-9 9-9Z" /><path d="M8 12h8M13 9l3 3-3 3" /></> : null}
        {role === "service" ? <><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M7 9h10M7 13h6" /></> : null}
        {role === "event-bus" ? <><path d="M4 7h16M4 12h16M4 17h16" /><circle cx="8" cy="7" r="1.5" /><circle cx="15" cy="12" r="1.5" /><circle cx="11" cy="17" r="1.5" /></> : null}
        {role === "worker" ? <><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8" /><circle cx="12" cy="12" r="4" /></> : null}
        {role === "database" ? <><ellipse cx="12" cy="6" rx="7" ry="3" /><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3" /></> : null}
        {role === "cache" ? <><path d="m12 3 8 4-8 4-8-4 8-4Z" /><path d="m5 12 7 4 7-4M5 16l7 4 7-4" /></> : null}
        {role === "agent" ? <><path d="M8 4h8l4 7-4 9H8l-4-9 4-7Z" /><circle cx="9" cy="11" r="1" /><circle cx="15" cy="11" r="1" /><path d="M9 16h6" /></> : null}
        {role === "tool" ? <><path d="M14 6a5 5 0 0 0-7 6L3 16l5 5 4-4a5 5 0 0 0 6-7l-3 3-3-3 2-4Z" /></> : null}
        {role === "model" ? <><circle cx="12" cy="12" r="8" /><path d="M8 9c2-3 6-3 8 0M8 15c2 3 6 3 8 0M7 12h10" /></> : null}
        {role === "start" ? <><rect x="3" y="7" width="18" height="10" rx="5" /><path d="M8 12h8" /></> : null}
        {role === "process" ? <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M7 9h10M7 13h7" /></> : null}
        {role === "decision" ? <><path d="m12 3 9 9-9 9-9-9 9-9Z" /><path d="m9 12 2 2 4-5" /></> : null}
        {role === "input-output" ? <><path d="M6 5h15l-3 14H3L6 5Z" /><path d="M8 12h8" /></> : null}
        {role === "end" ? <><rect x="3" y="7" width="18" height="10" rx="5" /><circle cx="12" cy="12" r="2.5" /></> : null}
        {role === "document" ? <><path d="M4 4h16v14c-3-2-5 2-8 0s-5 2-8 0V4Z" /><path d="M8 8h8M8 12h6" /></> : null}
        {role === "subprocess" ? <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M7 5v14M17 5v14M9 9h6M9 13h4" /></> : null}
        {role === "manual-input" ? <><path d="m6 5 15 3v11H3L6 5Z" /><path d="M8 12h8" /></> : null}
        {role === "preparation" ? <><path d="m7 4 13 0 3 8-3 8H7l-4-8 4-8Z" /><path d="M8 12h8" /></> : null}
        {role === "delay" ? <><path d="M4 4h8a8 8 0 0 1 0 16H4V4Z" /><path d="M8 8v4l3 2" /></> : null}
        {role === "connector" ? <><circle cx="12" cy="12" r="8" /><path d="M8 12h8" /></> : null}
        {role === "off-page" ? <><path d="M5 3h14v13l-7 5-7-5V3Z" /><path d="M9 10h6" /></> : null}
        {role === "merge" ? <><path d="m12 20-9-16h18l-9 16Z" /><circle cx="12" cy="10" r="1.5" /></> : null}
        {role === "stored-data" ? <><path d="M6 4h12c-4 3-4 13 0 16H6c-4-3-4-13 0-16Z" /><path d="M6 4c4 3 4 13 0 16" /></> : null}
        {role === "zone" ? <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M7 4v5" /></> : null}
        {role === "group" ? <><rect x="4" y="4" width="16" height="16" rx="3" strokeDasharray="3 2" /><rect x="8" y="8" width="3" height="3" /><rect x="13" y="13" width="3" height="3" /></> : null}
        {role === "text" ? <><path d="M4 6h16M12 6v13M8 19h8" /></> : null}
        {role === "note" ? <><path d="M5 3h14v14l-4 4H5V3Z" /><path d="M15 21v-4h4M8 8h8M8 12h6" /></> : null}
      </svg>
    </span>
  );
}
