"use client";

import { useEffect, useMemo, useState } from "react";
import type { DiagramDocument } from "@/modules/diagram/schema";
import { roleColors } from "@/modules/catalog/catalog";
import { diagramSamples, templateCategories } from "@/modules/fixtures/diagram-samples";
import { compilePlan } from "@/modules/compiler/compile-plan";
import { layoutDocument } from "@/modules/layout/layout-document";

/**
 * The project manager.
 *
 * These used to be called workspaces and lived as a list in the left sidebar,
 * where they competed for space with the component library and showed nothing
 * beyond a name and a scene count. They are projects now, and they get a screen
 * of their own: a preview of each one, what is in it, and when it was last
 * touched — which is what you need to pick between more than three of them.
 */

export type ProjectSummary = {
  id: string;
  title: string;
  nodes: number;
  edges: number;
  scenes: number;
  mode: string;
  format: string;
};

export type ProjectBrowserProps = {
  open: boolean;
  projects: DiagramDocument[];
  activeId: string;
  onOpen(id: string): void;
  onCreate(): void;
  onRename(id: string, title: string): void;
  onDuplicate(id: string): void;
  onDelete(id: string): void;
  onUseTemplate(sample: (typeof diagramSamples)[number]): void;
  onClose(): void;
};

type Tab = "projects" | "templates";

export function summarise(document: DiagramDocument): ProjectSummary {
  return {
    id: document.id,
    title: document.workspaceTitle ?? document.title,
    nodes: document.nodes.length,
    edges: document.edges.length,
    scenes: document.scenes?.length ?? 1,
    mode: document.mode,
    format: document.format ?? "16:9",
  };
}

/** A miniature of the diagram, drawn from node positions alone. */
function Thumbnail({ document }: { document: DiagramDocument }) {
  const shapes = useMemo(() => {
    const nodes = document.nodes.filter((node) => node.role !== "zone" && node.role !== "group");
    if (!nodes.length) return null;
    const minX = Math.min(...nodes.map((node) => node.position.x));
    const minY = Math.min(...nodes.map((node) => node.position.y));
    const maxX = Math.max(...nodes.map((node) => node.position.x + node.size.width));
    const maxY = Math.max(...nodes.map((node) => node.position.y + node.size.height));
    const width = Math.max(1, maxX - minX);
    const height = Math.max(1, maxY - minY);
    return { nodes, minX, minY, width, height };
  }, [document.nodes]);

  if (!shapes) return <div className="project-thumb is-empty"><span>Empty</span></div>;

  return (
    <svg className="project-thumb" viewBox={`0 0 ${shapes.width} ${shapes.height}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      {document.edges.map((edge) => {
        const from = shapes.nodes.find((node) => node.id === edge.from);
        const to = shapes.nodes.find((node) => node.id === edge.to);
        if (!from || !to) return null;
        return <line
          key={edge.id}
          x1={from.position.x - shapes.minX + from.size.width / 2}
          y1={from.position.y - shapes.minY + from.size.height / 2}
          x2={to.position.x - shapes.minX + to.size.width / 2}
          y2={to.position.y - shapes.minY + to.size.height / 2}
          stroke="currentColor"
          strokeOpacity=".28"
          strokeWidth={Math.max(2, shapes.width / 260)}
        />;
      })}
      {shapes.nodes.map((node) => (
        <rect
          key={node.id}
          x={node.position.x - shapes.minX}
          y={node.position.y - shapes.minY}
          width={node.size.width}
          height={node.size.height}
          rx={Math.max(4, node.size.height / 8)}
          fill={node.color ?? roleColors[node.role] ?? "#64748b"}
          fillOpacity=".7"
        />
      ))}
    </svg>
  );
}

export function ProjectBrowser({
  open, projects, activeId, onOpen, onCreate, onRename, onDuplicate, onDelete, onUseTemplate, onClose,
}: ProjectBrowserProps) {
  const [tab, setTab] = useState<Tab>("projects");
  const [query, setQuery] = useState("");
  const [renaming, setRenaming] = useState<string>();
  const [draft, setDraft] = useState("");

  // compilePlan leaves every node at the origin — positions come from the
  // layout pass — so previews have to be laid out before they mean anything.
  // Done once, on first open, and kept for the life of the screen.
  const [laidOut, setLaidOut] = useState<Record<string, DiagramDocument>>({});
  useEffect(() => {
    if (!open) return;
    let active = true;
    void (async () => {
      const entries = await Promise.all(diagramSamples.map(async (sample) =>
        [sample.id, await layoutDocument(compilePlan(sample.plan))] as const));
      if (active) setLaidOut(Object.fromEntries(entries));
    })();
    return () => { active = false; };
  }, [open]);

  const templates = useMemo(() => diagramSamples.map((sample) => ({
    sample,
    document: laidOut[sample.id],
  })), [laidOut]);

  const visibleTemplates = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return templates;
    return templates.filter(({ sample }) =>
      sample.label.toLowerCase().includes(needle)
      || sample.description.toLowerCase().includes(needle)
      || sample.category.toLowerCase().includes(needle));
  }, [query, templates]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return projects;
    return projects.filter((project) =>
      (project.workspaceTitle ?? project.title).toLowerCase().includes(needle)
      || project.purpose.toLowerCase().includes(needle));
  }, [projects, query]);

  if (!open) return null;

  const commitRename = (id: string) => {
    const title = draft.trim();
    if (title) onRename(id, title);
    setRenaming(undefined);
  };

  return (
    <div className="project-browser" role="dialog" aria-label="Projects" aria-modal="true">
      <header>
        <div>
          <span>LIBRARY</span>
          <div className="project-tabs" role="tablist">
            <button
              aria-selected={tab === "projects"}
              className={tab === "projects" ? "is-on" : ""}
              onClick={() => { setTab("projects"); setQuery(""); }}
              role="tab"
            >Projects <b>{projects.length}</b></button>
            <button
              aria-selected={tab === "templates"}
              className={tab === "templates" ? "is-on" : ""}
              onClick={() => { setTab("templates"); setQuery(""); }}
              role="tab"
            >Templates <b>{templates.length}</b></button>
          </div>
        </div>
        <div className="project-browser-actions">
          <label className="search">
            <span>⌕</span>
            <input
              aria-label="Search projects"
              onChange={(event) => setQuery(event.target.value)}
              placeholder={tab === "projects" ? "Search by name or purpose" : "Search templates"}
              value={query}
            />
          </label>
          {tab === "projects" ? <button className="primary" onClick={onCreate}>New project</button> : null}
          <button aria-label="Close projects" className="close" onClick={onClose}>×</button>
        </div>
      </header>

      {tab === "projects" ? <div className="project-grid">
        {visible.map((project) => {
          const summary = summarise(project);
          return (
            <article className={project.id === activeId ? "is-active" : ""} key={project.id}>
              <button className="project-open" onClick={() => { onOpen(project.id); onClose(); }} title="Open this project">
                <Thumbnail document={project} />
              </button>
              <div className="project-meta">
                {renaming === project.id ? (
                  <input
                    aria-label="Project name"
                    autoFocus
                    onBlur={() => commitRename(project.id)}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") commitRename(project.id);
                      if (event.key === "Escape") setRenaming(undefined);
                    }}
                    value={draft}
                  />
                ) : (
                  <strong onDoubleClick={() => { setRenaming(project.id); setDraft(summary.title); }}>{summary.title}</strong>
                )}
                <small>{summary.mode} · {summary.nodes} components · {summary.edges} connections{summary.scenes > 1 ? ` · ${summary.scenes} scenes` : ""}</small>
                <small className="project-when">{summary.format}</small>
              </div>
              <div className="project-row-actions">
                <button onClick={() => { setRenaming(project.id); setDraft(summary.title); }}>Rename</button>
                <button onClick={() => onDuplicate(project.id)}>Duplicate</button>
                <button
                  className="danger"
                  disabled={projects.length === 1}
                  onClick={() => { if (window.confirm(`Delete “${summary.title}”? This cannot be undone.`)) onDelete(project.id); }}
                  title={projects.length === 1 ? "The last project cannot be deleted" : "Delete this project"}
                >Delete</button>
              </div>
            </article>
          );
        })}
        {visible.length === 0 ? (
          <p className="project-empty">No project matches “{query}”.</p>
        ) : null}
      </div> : (
        <div className="template-panel">
          {templateCategories.map((category) => {
            const group = visibleTemplates.filter(({ sample }) => sample.category === category);
            if (!group.length) return null;
            return (
              <section key={category}>
                <h3>{category}</h3>
                <div className="project-grid is-templates">
                  {group.map(({ sample, document }) => (
                    <article key={sample.id}>
                      <button
                        className="project-open"
                        onClick={() => { onUseTemplate(sample); onClose(); }}
                        title={`Start a project from ${sample.label}`}
                      >
                        {document
                          ? <Thumbnail document={document} />
                          : <div className="project-thumb is-empty"><span>…</span></div>}
                      </button>
                      <div className="project-meta">
                        <strong>{sample.label}</strong>
                        <small>{sample.description}</small>
                        <small className="project-when">{sample.plan.mode} · {sample.plan.nodes.length} components</small>
                      </div>
                      <div className="project-row-actions">
                        <button onClick={() => { onUseTemplate(sample); onClose(); }}>Use template</button>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            );
          })}
          {visibleTemplates.length === 0 ? <p className="project-empty">No template matches “{query}”.</p> : null}
        </div>
      )}
    </div>
  );
}
