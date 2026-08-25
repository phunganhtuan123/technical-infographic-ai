import { Handle, NodeResizer, Position, type Node, type NodeProps } from "@xyflow/react";
import { createContext, useContext, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { ComponentIcon } from "@/modules/catalog/component-icon";
import { TechnologyIcon } from "@/modules/catalog/technology-icon";
import type { DiagramNode } from "@/modules/diagram/schema";

export type SemanticNodeData = DiagramNode & Record<string, unknown>;
export type SemanticFlowNode = Node<SemanticNodeData, "semantic">;
export const NodeInlineEditContext = createContext<(nodeId: string, updates: Pick<DiagramNode, "label"> | Pick<DiagramNode, "detail">) => void>(() => undefined);
export const ContainerLabelMoveContext = createContext<(nodeId: string, labelPosition: NonNullable<DiagramNode["labelPosition"]>) => void>(() => undefined);

const handles = [
  ["input", Position.Left],
  ["output", Position.Right],
  ["top-center", Position.Top],
  ["event-input", Position.Top],
  ["event-input-bottom", Position.Bottom],
  ["event-output", Position.Bottom],
  ["data-input", Position.Top],
  ["data-output", Position.Bottom],
] as const;

const flowShapes = {
  start: "M43 8H177a42 42 0 0 1 0 84H43a42 42 0 0 1 0-84Z",
  process: "M2 2H218V102H2Z",
  decision: "M110 2 218 52 110 102 2 52Z",
  "input-output": "M28 2H218L192 102H2Z",
  end: "M43 8H177a42 42 0 0 1 0 84H43a42 42 0 0 1 0-84Z",
  document: "M2 2H218V88C184 74 148 104 110 88C72 72 36 104 2 88Z",
  subprocess: "M2 2H218V102H2ZM18 2V102M202 2V102",
  "manual-input": "M28 12 218 2V102H2Z",
  preparation: "M28 2H192L218 52 192 102H28L2 52Z",
  delay: "M2 2H160C237 2 237 102 160 102H2Z",
  connector: "M110 2A50 50 0 1 1 110 102A50 50 0 1 1 110 2Z",
  "off-page": "M30 2H190V76L110 102 30 76Z",
  merge: "M110 102 28 2H192Z",
  "stored-data": "M28 2H198C176 24 176 80 198 102H28C6 80 6 24 28 2Z",
} as const;

const fontFamilies = {
  "geist-mono": '"Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
  "jetbrains-mono": '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
  "ibm-plex-mono": '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
  "system-sans": 'Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
} as const;

function InlineField({ ariaLabel, className, value, onChange }: { ariaLabel: string; className: string; value: string; onChange: (value: string) => void }) {
  return <input aria-label={ariaLabel} className={`${className} nodrag nowheel`} value={value} onChange={(event) => onChange(event.target.value)} onKeyDown={(event) => { event.stopPropagation(); if (event.key === "Enter") event.currentTarget.blur(); }} />;
}

function containerLabelStyle(position: NonNullable<DiagramNode["labelPosition"]>): CSSProperties {
  if (position.side === "top") return { left: `${position.offset * 100}%`, top: 0, transform: "translate(-50%, -50%)" };
  if (position.side === "bottom") return { left: `${position.offset * 100}%`, bottom: 0, transform: "translate(-50%, 50%)" };
  if (position.side === "left") return { left: 0, top: `${position.offset * 100}%`, transform: "translate(-50%, -50%) rotate(-90deg)" };
  return { right: 0, top: `${position.offset * 100}%`, transform: "translate(50%, -50%) rotate(90deg)" };
}

export function SemanticNode({ data, selected }: NodeProps<SemanticFlowNode>) {
  const editNode = useContext(NodeInlineEditContext);
  const moveContainerLabel = useContext(ContainerLabelMoveContext);
  const shape = data.role in flowShapes ? flowShapes[data.role as keyof typeof flowShapes] : undefined;
  const label = selected ? <InlineField ariaLabel="Inline component name" className="node-inline-name" value={data.label} onChange={(value) => editNode(data.id, { label: value })} /> : <strong>{data.label}</strong>;
  const detail = selected ? <InlineField ariaLabel="Inline component description" className="node-inline-detail" value={data.detail ?? ""} onChange={(value) => editNode(data.id, { detail: value })} /> : null;
  const isContainer = data.role === "zone" || data.role === "group";
  const isAnnotation = data.role === "text" || data.role === "note";
  const fontFamily = data.fontFamily ?? "geist-mono";
  const fontSize = data.fontSize ?? (data.role === "text" ? 18 : data.role === "note" ? 13 : isContainer ? 10 : 14);
  const fontWeight = data.fontWeight ?? (isContainer ? 600 : 700);
  const textAlign = data.textAlign ?? (shape ? "center" : "left");
  const startContainerLabelDrag = (event: ReactPointerEvent<HTMLSpanElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const bounds = event.currentTarget.closest("article")!.getBoundingClientRect();
    const onMove = (moveEvent: PointerEvent) => {
      const distances = [
        { side: "top" as const, distance: Math.abs(moveEvent.clientY - bounds.top), offset: (moveEvent.clientX - bounds.left) / bounds.width },
        { side: "right" as const, distance: Math.abs(moveEvent.clientX - bounds.right), offset: (moveEvent.clientY - bounds.top) / bounds.height },
        { side: "bottom" as const, distance: Math.abs(moveEvent.clientY - bounds.bottom), offset: (moveEvent.clientX - bounds.left) / bounds.width },
        { side: "left" as const, distance: Math.abs(moveEvent.clientX - bounds.left), offset: (moveEvent.clientY - bounds.top) / bounds.height },
      ];
      const nearest = distances.sort((left, right) => left.distance - right.distance)[0];
      moveContainerLabel(data.id, { side: nearest.side, offset: Math.max(0.06, Math.min(0.94, nearest.offset)) });
    };
    const onEnd = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd, { once: true });
  };
  return (
    <article
      className={`semantic-node semantic-node--${data.role}${shape ? " semantic-node--flow" : ""} node-border-${data.borderStyle}${data.effect !== "none" ? ` node-effect-${data.effect}` : ""}${data.previewStatus ? ` preview-${data.previewStatus}` : ""}${selected ? " is-selected" : ""}`}
      style={{ "--node-color": data.color, "--node-text-color": data.textColor ?? "#f5f5f5", "--node-font-family": fontFamilies[fontFamily], "--node-font-size": `${fontSize}px`, "--node-font-weight": fontWeight, "--node-text-align": textAlign, "--node-border-width": `${data.borderWidth}px`, "--node-speed": `${data.speed}s` } as React.CSSProperties}
    >
      <NodeResizer color={data.color} handleClassName="node-resize-handle" isVisible={selected} lineClassName="node-resize-line" minHeight={isContainer ? 160 : 72} minWidth={isContainer ? 280 : 140} maxHeight={isContainer ? 900 : 260} maxWidth={isContainer ? 1400 : 440} />
      {data.backgroundImage ? <span aria-hidden="true" className="node-background" style={{ backgroundImage: `url(${JSON.stringify(data.backgroundImage)})`, backgroundPosition: "center", backgroundRepeat: "no-repeat", backgroundSize: data.backgroundFit ?? "cover", opacity: data.backgroundOpacity ?? 0.28 }} /> : null}
      {shape ? <svg className="node-shape" preserveAspectRatio="none" viewBox="0 0 220 104" aria-hidden="true"><path className={`node-shape-fill is-${data.borderStyle}`} d={shape} /></svg> : null}
      {!isContainer && !isAnnotation ? handles.flatMap(([id, position]) => [
        <Handle aria-hidden="true" className={`semantic-handle semantic-handle--${id} semantic-handle--target-pair`} id={`${id}--target`} key={`${id}-target`} position={position} type="target" />,
        <Handle aria-label={`Connection point ${id}`} className={`semantic-handle semantic-handle--${id} semantic-handle--source-pair`} id={`${id}--source`} key={`${id}-source`} position={position} role="button" type="source" />,
      ]) : null}
      {isContainer ? <>
        <span aria-hidden="true" className="container-drag-edge is-top" />
        <span aria-hidden="true" className="container-drag-edge is-right" />
        <span aria-hidden="true" className="container-drag-edge is-bottom" />
        <span aria-hidden="true" className="container-drag-edge is-left" />
        <span className="container-label nodrag" onPointerDown={startContainerLabelDrag} style={containerLabelStyle(data.labelPosition ?? { side: "top", offset: 0.16 })}>{data.label}</span>
      </> : isAnnotation ? <div className={`annotation-content annotation-content--${data.role}`}>{label}{detail ?? <span>{data.detail}</span>}</div> : shape ? <div className="flow-node-content"><span><ComponentIcon compact role={data.role} />{data.role.replace("-", " ")}</span>{label}{detail ?? <small>{data.detail ?? "flow step"}</small>}</div> : <>
        <div className="node-head">
          <span className="node-identity"><ComponentIcon compact role={data.role} /><span className="node-role">{data.role.replace("-", " ")}</span></span>
          <span className="node-indicators"><TechnologyIcon compact provider={data.provider} technology={data.technology} /><span className="node-status" aria-hidden="true" /></span>
        </div>
        {label}
        <div className="node-foot">
          {detail ?? <span>{data.detail ?? data.technology ?? "system component"}</span>}
          {data.technology ? <b>{data.technology.replace("gcp-", "").replace("aws-", "")}</b> : null}
        </div>
      </>}
      {!isContainer && data.caption ? <span className="node-caption">{data.caption}</span> : null}
      {!isContainer && data.note ? <span className="node-note">{data.note}</span> : null}
    </article>
  );
}
