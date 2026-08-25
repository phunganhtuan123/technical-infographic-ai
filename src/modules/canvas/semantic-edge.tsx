import {
  BaseEdge,
  EdgeLabelRenderer,
  type Edge,
  type EdgeProps,
  useReactFlow,
  useStore,
} from "@xyflow/react";
import { createContext, useContext, useEffect, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import type { DiagramNode, EdgeDirection, EdgeEffect, EdgeSemantics, EdgeStrokeStyle } from "@/modules/diagram/schema";
import type { SemanticFlowNode } from "./semantic-node";
import { routeOrthogonal, type RouteControl, type RoutePoint } from "./orthogonal-router";

type SemanticEdgeData = {
  semantics: EdgeSemantics;
  important: boolean;
  animated: boolean;
  direction: EdgeDirection;
  thickness: number;
  color: string;
  strokeStyle: EdgeStrokeStyle;
  effect: EdgeEffect;
  speed: number;
  labelOffset: { x: number; y: number };
  routeWaypoints?: Array<{ x: number; y: number }>;
  routeWaypoint?: { x: number; y: number };
  routeOffset?: number;
} & Record<string, unknown>;

export type SemanticFlowEdge = Edge<SemanticEdgeData, "semantic">;
export const EdgeLabelMoveContext = createContext<(edgeId: string, offset: { x: number; y: number }) => void>(() => undefined);
export const EdgeRouteMoveContext = createContext<(edgeId: string, waypoints: Array<{ x: number; y: number }>) => void>(() => undefined);
export const EdgeCaptionEditContext = createContext<(edgeId: string, label: string) => void>(() => undefined);
export const edgeCaptionEditEvent = "technical-infographic:edit-edge-caption";

const colors: Record<EdgeSemantics, string> = {
  request: "#b6ff5c",
  event: "#fbbf24",
  data: "#a78bfa",
  feedback: "#a78bfa",
  success: "#b6ff5c",
  failure: "#fb7185",
};

function outward(point: RoutePoint, position: EdgeProps<SemanticFlowEdge>["sourcePosition"], distance: number) {
  if (position === "left") return { x: point.x - distance, y: point.y };
  if (position === "right") return { x: point.x + distance, y: point.y };
  if (position === "top") return { x: point.x, y: point.y - distance };
  return { x: point.x, y: point.y + distance };
}

function liesOnSegment(point: RoutePoint, start: RoutePoint, end: RoutePoint) {
  if (start.x === end.x) return Math.abs(point.x - start.x) <= 1 && point.y >= Math.min(start.y, end.y) - 1 && point.y <= Math.max(start.y, end.y) + 1;
  return Math.abs(point.y - start.y) <= 1 && point.x >= Math.min(start.x, end.x) - 1 && point.x <= Math.max(start.x, end.x) + 1;
}

export function SemanticEdge(props: EdgeProps<SemanticFlowEdge>) {
  const moveLabel = useContext(EdgeLabelMoveContext);
  const moveRoute = useContext(EdgeRouteMoveContext);
  const editCaption = useContext(EdgeCaptionEditContext);
  const [captionDraft, setCaptionDraft] = useState(typeof props.label === "string" ? props.label : "");
  const [editingCaption, setEditingCaption] = useState(false);
  const { screenToFlowPosition } = useReactFlow();
  const flowNodes = useStore((state) => state.nodes) as SemanticFlowNode[];
  const obstacles = flowNodes.filter((node) => node.id !== props.source && node.id !== props.target && node.data.role !== "zone" && node.data.role !== "group").map((node) => ({
    x: node.position.x,
    y: node.position.y,
    width: node.measured?.width ?? Number((node.data as Partial<DiagramNode>).size?.width ?? 220),
    height: node.measured?.height ?? Number((node.data as Partial<DiagramNode>).size?.height ?? 104),
  }));
  const endpointInset = 3;
  const protectedObstacles = flowNodes.filter((node) => node.id === props.source || node.id === props.target).map((node) => {
    const width = node.measured?.width ?? Number((node.data as Partial<DiagramNode>).size?.width ?? 220);
    const height = node.measured?.height ?? Number((node.data as Partial<DiagramNode>).size?.height ?? 104);
    return {
      x: node.position.x + endpointInset,
      y: node.position.y + endpointInset,
      width: Math.max(1, width - endpointInset * 2),
      height: Math.max(1, height - endpointInset * 2),
    };
  });
  const manualWaypoints = props.data?.routeWaypoints ?? (props.data?.routeWaypoint ? [props.data.routeWaypoint] : undefined);
  const markerPadding = 6;
  const routeSource = props.data?.direction === "reverse" || props.data?.direction === "both"
    ? outward({ x: props.sourceX, y: props.sourceY }, props.sourcePosition, markerPadding)
    : { x: props.sourceX, y: props.sourceY };
  const routeTarget = props.data?.direction === "forward" || props.data?.direction === "both"
    ? outward({ x: props.targetX, y: props.targetY }, props.targetPosition, markerPadding)
    : { x: props.targetX, y: props.targetY };
  const { path, labelX, labelY, controls, points } = routeOrthogonal({
    source: routeSource,
    target: routeTarget,
    sourcePosition: props.sourcePosition,
    targetPosition: props.targetPosition,
    obstacles,
    protectedObstacles,
    waypoints: manualWaypoints,
    offset: props.data?.routeOffset ?? 16,
  });
  const color = props.data?.color ?? colors[props.data?.semantics ?? "request"];
  const style = props.data?.strokeStyle ?? "solid";
  const effect = props.data?.effect ?? "pulse";
  const speed = props.data?.speed ?? 2.1;
  const dasharray = style === "dashed" ? "8 7" : style === "dotted" ? "1 7" : undefined;
  const effectClass = props.data?.animated ? ` effect-${effect}` : "";
  const labelOffset = props.data?.labelOffset ?? { x: 0, y: 0 };
  useEffect(() => {
    const startEditing = (event: Event) => {
      if ((event as CustomEvent<{ edgeId: string }>).detail?.edgeId !== props.id) return;
      setCaptionDraft(typeof props.label === "string" ? props.label : "");
      setEditingCaption(true);
    };
    window.addEventListener(edgeCaptionEditEvent, startEditing);
    return () => window.removeEventListener(edgeCaptionEditEvent, startEditing);
  }, [props.id, props.label]);
  const startLabelDrag = (event: ReactPointerEvent<HTMLSpanElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const pathElement = document.createElementNS("http://www.w3.org/2000/svg", "path");
    pathElement.setAttribute("d", path);
    const pathLength = pathElement.getTotalLength();
    const onMove = (moveEvent: PointerEvent) => {
      const pointer = screenToFlowPosition({ x: moveEvent.clientX, y: moveEvent.clientY });
      let nearest = pathElement.getPointAtLength(0);
      let nearestDistance = Number.POSITIVE_INFINITY;
      for (let sample = 0; sample <= 96; sample += 1) {
        const point = pathElement.getPointAtLength(pathLength * sample / 96);
        const distance = (point.x - pointer.x) ** 2 + (point.y - pointer.y) ** 2;
        if (distance < nearestDistance) {
          nearest = point;
          nearestDistance = distance;
        }
      }
      moveLabel(props.id, { x: nearest.x - labelX, y: nearest.y - labelY });
    };
    const onEnd = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd, { once: true });
  };
  const startRouteDrag = (event: ReactPointerEvent<SVGCircleElement>, control: RouteControl) => {
    event.preventDefault();
    event.stopPropagation();
    const segmentStart = points[control.segmentIndex - 1];
    const segmentEnd = points[control.segmentIndex];
    const initialWaypoints = (manualWaypoints ?? []).map((point) => ({ ...point }));
    let waypointIndex = initialWaypoints.findIndex((point) => liesOnSegment(point, segmentStart, segmentEnd));
    if (waypointIndex < 0) {
      waypointIndex = initialWaypoints.length;
      initialWaypoints.push({ x: control.x, y: control.y });
    }
    const onMove = (moveEvent: PointerEvent) => {
      const pointer = screenToFlowPosition({ x: moveEvent.clientX, y: moveEvent.clientY });
      const moved = control.orientation === "horizontal" ? { x: control.x, y: pointer.y } : { x: pointer.x, y: control.y };
      moveRoute(props.id, initialWaypoints.map((point, index) => index === waypointIndex ? moved : point));
    };
    const onEnd = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd, { once: true });
  };

  return (
    <>
      <BaseEdge
        id={`${props.id}-casing`}
        className="semantic-edge-casing"
        interactionWidth={0}
        path={path}
        style={{
          stroke: "#080808",
          strokeWidth: (props.data?.thickness ?? 1.8) + 9,
          strokeLinecap: "round",
          strokeLinejoin: "round",
          opacity: 1,
        }}
      />
      <BaseEdge
        id={`${props.id}-halo`}
        className="semantic-edge-halo"
        interactionWidth={0}
        path={path}
        style={{ stroke: color, strokeWidth: (props.data?.thickness ?? 1.8) + 2.5, strokeLinecap: "round", strokeLinejoin: "round", opacity: props.selected ? 0.34 : 0.16 }}
      />
      <BaseEdge
        id={props.id}
        interactionWidth={22}
        path={path}
        markerEnd={props.markerEnd}
        markerStart={props.markerStart}
        className={`semantic-edge-path${effectClass}${props.data?.previewStatus ? ` preview-${props.data.previewStatus}` : ""}`}
        style={{
          "--edge-speed": `${speed}s`,
          "--edge-color": color,
          stroke: color,
          strokeWidth: props.data?.thickness ?? (props.data?.important ? 1.8 : 1.2),
          strokeDasharray: effect === "trail" && props.data?.animated && style === "solid" ? "12 9" : dasharray,
          strokeLinecap: style === "dotted" ? "round" : undefined,
          opacity: props.selected ? 1 : props.data?.important ? 0.88 : 0.42,
          filter: props.selected ? `drop-shadow(0 0 5px ${color})` : undefined,
        } as CSSProperties}
      />
      {props.data?.animated && (effect === "pulse" || effect === "signal") ? (
        <circle className="flow-pulse" fill={color} r="3.5">
          <animateMotion dur={`${speed}s`} path={path} repeatCount="indefinite" />
        </circle>
      ) : null}
      {props.data?.animated && effect === "signal" ? [0.33, 0.66].map((offset) => (
        <circle className="flow-pulse flow-pulse--signal" fill={color} key={offset} r="2.4">
          <animateMotion begin={`-${speed * offset}s`} dur={`${speed}s`} path={path} repeatCount="indefinite" />
        </circle>
      )) : null}
      {props.selected ? controls.map((control, index) => (
        <circle aria-label={`Drag connection path segment ${index + 1}`} className={`edge-route-handle edge-route-handle--${control.orientation} nodrag`} cx={control.x} cy={control.y} key={`${control.x}-${control.y}-${index}`} onClick={(event) => event.stopPropagation()} onPointerDown={(event) => startRouteDrag(event, control)} r="6" role="button" style={{ "--edge-color": color } as CSSProperties} tabIndex={0} />
      )) : null}
      {props.label || editingCaption ? (
        <EdgeLabelRenderer>
          {editingCaption ? <input
            aria-label="Inline connection caption"
            autoFocus
            className="edge-label edge-label-input nodrag nowheel"
            onBlur={() => { editCaption(props.id, captionDraft.trim()); setEditingCaption(false); }}
            onChange={(event) => setCaptionDraft(event.target.value)}
            onKeyDown={(event) => { event.stopPropagation(); if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") setEditingCaption(false); }}
            style={{ color, transform: `translate(-50%, -50%) translate(${labelX + labelOffset.x}px,${labelY + labelOffset.y}px)` }}
            value={captionDraft}
          /> : <span
            className={`edge-label${props.selected ? " is-selected" : ""}`}
            onDoubleClick={() => { setCaptionDraft(typeof props.label === "string" ? props.label : ""); setEditingCaption(true); }}
            onPointerDown={startLabelDrag}
            style={{ color, transform: `translate(-50%, -50%) translate(${labelX + labelOffset.x}px,${labelY + labelOffset.y}px)` }}
          >{props.label}</span>}
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}
