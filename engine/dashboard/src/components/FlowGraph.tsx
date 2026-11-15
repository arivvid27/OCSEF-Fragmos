import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useStore,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/base.css'
import { useEffect, useMemo } from 'react'
import { ACTIONS, type EventId, type Hop, type SentinelEvent, type Upstream } from '../api'
import { upstreamTitle } from '../event'
import { edgeId, kindOf, latestTouching, layout, nameOf, type Graph, type NodeKind } from '../graph'
import { ACTION_STYLE } from '../theme'
import { ActionChip } from './ActionChip'

type BoxData = { kind: NodeKind; title: string; sub: string; simulated: boolean; hop: Hop | null }
type BoxNode = Node<BoxData, 'box'>
type LaneData = { text: string }
type LaneNode = Node<LaneData, 'lane'>
type FlowData = { hop: Hop | null; pulse: string | null; delay: number }
type FlowEdgeType = Edge<FlowData, 'flow'>

const BOX_STYLE: Record<NodeKind, string> = {
  agent: 'rounded-xl bg-slate-900 ring-slate-600',
  sentinel: 'rounded-2xl bg-slate-900 ring-slate-500',
  model: 'rounded-lg bg-slate-900 ring-slate-700',
  tool: 'rounded-md bg-slate-900/80 ring-slate-700',
  domain: 'rounded-md bg-slate-950 ring-slate-700',
}

function Box({ data }: NodeProps<BoxNode>) {
  const { kind, title, sub, simulated, hop } = data
  const color = hop ? ACTION_STYLE[hop.action].stroke : undefined
  const blocked = hop?.state === 'blocked'
  const big = kind === 'agent' || kind === 'sentinel'
  return (
    <div
      className={`flex h-full w-full flex-col justify-center px-3 ring-1 ring-inset transition-shadow duration-500 ${BOX_STYLE[kind]} ${
        big ? 'items-center text-center' : ''
      } ${simulated ? 'bg-red-950/40' : ''}`}
      style={color ? { boxShadow: `inset 0 0 0 ${blocked ? 2 : 1.5}px ${blocked ? ACTION_STYLE.BLOCK.stroke : color}, 0 0 18px -4px ${color}` } : undefined}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} style={{ opacity: 0 }} />
      <div
        className={`truncate leading-tight ${
          kind === 'sentinel'
            ? 'text-sm font-semibold tracking-[0.25em] text-slate-50'
            : kind === 'tool' || kind === 'domain'
              ? 'font-mono text-[12px] text-slate-200'
              : 'text-[12px] font-medium text-slate-100'
        }`}
      >
        {title}
      </div>
      {sub && (
        <div className={`truncate text-[10px] leading-tight ${simulated ? 'text-red-300' : 'text-slate-400'} ${kind === 'model' ? 'font-mono' : ''}`}>
          {sub}
        </div>
      )}
      <Handle type="source" position={Position.Right} isConnectable={false} style={{ opacity: 0 }} />
    </div>
  )
}

function Lane({ data }: NodeProps<LaneNode>) {
  return <div className="text-[9px] font-semibold uppercase tracking-[0.2em] text-slate-600">{data.text}</div>
}

function Flow({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data }: EdgeProps<FlowEdgeType>) {
  const [path] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition })
  const hop = data?.hop ?? null
  const color = hop ? ACTION_STYLE[hop.action].stroke : undefined
  return (
    <>
      <BaseEdge path={path} style={{ stroke: 'var(--color-slate-700)', strokeWidth: 1.25 }} interactionWidth={16} />
      <path
        d={path}
        className={`flow-lit ${hop?.state ?? ''}`}
        style={{ stroke: color ?? 'var(--color-slate-700)', color, opacity: hop ? 1 : 0 }}
      />
      {hop && data?.pulse && (
        <path key={data.pulse} d={path} pathLength={100} className="flow-pulse" style={{ stroke: color, color, animationDelay: `${data.delay}s` }} />
      )}
      {hop?.state === 'blocked' && (
        <EdgeLabelRenderer>
          <div className="pointer-events-none absolute" style={{ transform: `translate(-50%, -50%) translate(${targetX - 15}px, ${targetY}px)` }}>
            <div
              key={data?.pulse}
              className="flow-x grid size-6 place-items-center rounded-full bg-red-600 text-sm font-bold leading-none text-white ring-2 ring-red-300/60"
              style={{ animationDelay: `${(data?.delay ?? 0) + 0.6}s` }}
            >
              ✕
            </div>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}

const nodeTypes = { box: Box, lane: Lane }
const edgeTypes = { flow: Flow }
const DEPTH_DELAY_S: Record<NodeKind, number> = { agent: 0, sentinel: 0.45, tool: 0.9, model: 0.9, domain: 0.9 }

function describe(id: string, upstreams: readonly Upstream[]): Pick<BoxData, 'title' | 'sub' | 'simulated'> {
  const kind = kindOf(id)
  if (kind === 'agent') return { title: 'Agent', sub: 'files · web · email', simulated: false }
  if (kind === 'sentinel') return { title: 'SENTINEL', sub: 'privacy firewall', simulated: false }
  if (kind === 'model') {
    const u = upstreams.find((x) => x.id === nameOf(id))
    if (!u) return { title: nameOf(id), sub: '', simulated: false }
    return { title: upstreamTitle(u), sub: u.simulated ? `${u.model} · scripted` : u.model, simulated: u.simulated }
  }
  return { title: nameOf(id), sub: '', simulated: false }
}

function toFlow(graph: Graph, upstreams: readonly Upstream[]): { nodes: (BoxNode | LaneNode)[]; edges: FlowEdgeType[] } {
  const into = new Map<string, Hop>()
  for (const { hop } of graph.lit.values()) {
    const prev = into.get(hop.dst)
    if (!prev || hop.state === 'blocked' || ACTIONS.indexOf(hop.action) > ACTIONS.indexOf(prev.action)) into.set(hop.dst, hop)
  }
  const boxes: BoxNode[] = graph.slots.map((s) => ({
    id: s.id,
    type: 'box',
    position: { x: s.x, y: s.y },
    // Without `measured`, React Flow drops a replaced node's handle bounds, which unmounts its edges for a frame
    // and restarts their pulse animation. Nodes are rebuilt on every event, so the known size is declared here.
    width: s.width,
    height: s.height,
    measured: { width: s.width, height: s.height },
    data: { kind: s.kind, hop: into.get(s.id) ?? null, ...describe(s.id, upstreams) },
  }))
  const firstOf = (kind: NodeKind) => graph.slots.find((s) => s.kind === kind)
  const lanes: LaneNode[] = (
    [
      ['model', 'models'],
      ['tool', 'tools'],
      ['domain', 'destinations'],
    ] as const
  ).flatMap(([kind, text]) => {
    const s = firstOf(kind)
    const size = { width: 160, height: 12 }
    return s ? [{ id: `lane:${kind}`, type: 'lane' as const, position: { x: s.x + 2, y: s.y - 14 }, data: { text }, ...size, measured: size }] : []
  })
  const edges: FlowEdgeType[] = graph.edges
    .map((e) => {
      const lit = graph.lit.get(e.id) ?? null
      return {
        id: e.id,
        source: e.src,
        target: e.dst,
        type: 'flow' as const,
        data: { hop: lit?.hop ?? null, pulse: lit?.pulse ?? null, delay: DEPTH_DELAY_S[kindOf(e.src)] },
      }
    })
  return { nodes: [...boxes, ...lanes], edges }
}

/** A fixed frame: nodes never move on screen when a new one appears. */
function FitFrame({ bounds }: { bounds: Graph['bounds'] }) {
  const { fitBounds } = useReactFlow()
  const width = useStore((s) => s.width)
  const height = useStore((s) => s.height)
  const { x, y, width: w, height: h } = bounds
  useEffect(() => {
    if (width && height) void fitBounds({ x, y: y - 16, width: w, height: h + 16 }, { padding: 0.04 })
  }, [fitBounds, width, height, x, y, w, h])
  return null
}

export function FlowGraph({
  events,
  upstreams,
  onSelect,
}: {
  events: ReadonlyMap<EventId, SentinelEvent>
  upstreams: readonly Upstream[]
  onSelect: (id: EventId) => void
}) {
  const graph = useMemo(() => layout(events.values(), upstreams), [events, upstreams])
  const { nodes, edges } = useMemo(() => toFlow(graph, upstreams), [graph, upstreams])
  const select = (id: EventId | null) => id && onSelect(id)

  return (
    <section className="flex shrink-0 flex-col rounded-xl bg-slate-900/40 ring-1 ring-inset ring-slate-800">
      <div className="flex items-center gap-3 px-4 pt-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Data flow</h2>
        <span className="truncate text-[11px] text-slate-500">
          {graph.latest ? 'lit path is the latest turn · click a node or edge for its event' : 'waiting for traffic'}
        </span>
        <span className="ml-auto flex shrink-0 gap-1">
          {ACTIONS.map((a) => (
            <ActionChip key={a} action={a} small />
          ))}
        </span>
      </div>
      <div className="h-80">
        <ReactFlowProvider>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            colorMode="dark"
            style={{ background: 'transparent' }}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            panOnDrag={false}
            zoomOnScroll={false}
            zoomOnPinch={false}
            zoomOnDoubleClick={false}
            preventScrolling={false}
            proOptions={{ hideAttribution: true }}
            onNodeClick={(_, node) => select(latestTouching(events.values(), (h) => h.dst === node.id || h.src === node.id))}
            onEdgeClick={(_, edge) => select(latestTouching(events.values(), (h) => edgeId(h.src, h.dst) === edge.id))}
          >
            <FitFrame bounds={graph.bounds} />
          </ReactFlow>
        </ReactFlowProvider>
      </div>
    </section>
  )
}
