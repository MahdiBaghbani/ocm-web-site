import { useEffect, useRef, useState, useCallback } from 'react';
import { heroConfig, type SpecialNodeConfig } from '../../lib/hero/config';
import {
  type GridCoord,
  type TrailPoint,
  type Point,
  chebyshevDistance,
  selectWaypointsWithConstraints,
  getLivePositionOnPath,
  resolveTrailPoint,
} from '../../lib/hero/grid/pathfinding';

// ============================================================
// Type Definitions
// ============================================================

interface GridNode {
  i: number;
  j: number;
  x: number;
  y: number;
  baseX: number;
  baseY: number;
  size: number;
  baseSize: number;
  targetSize: number;
  opacity: number;
  baseOpacity: number;
  nodeType: number;
  specialIndex: number;
  fedColor: [number, number, number] | null;
  isHub: boolean;
  edges: MeshEdge[];
}

interface MeshEdge {
  fromNode: GridNode;
  toNode: GridNode;
  fromIdx: number;
  toIdx: number;
  edgeType: 'horizontal' | 'vertical' | 'diagonal';
  diagonalDir: '/' | '\\' | null;
  visible: boolean;
  fedColor: [number, number, number] | null;
  opacity: number;
  baseOpacity: number;
}

interface SpecialNodeRuntime extends SpecialNodeConfig {
  gridI: number;
  gridJ: number;
  screenX: number;
  screenY: number;
  nodeType: number;
}

interface PulseState {
  id: number;
  fromIdx: number;
  toIdx: number;
  stepIndex: number;
  progress: number;
  speedFactor: number;
  stepDuration: number;
  gridPath: GridCoord[];
  trail: (TrailPoint | undefined)[];
  trailHeadIdx: number;
  dyingTrail: TrailPoint[];
  dyingTrailAlpha: number;
  dyingTrailGridPath: GridCoord[];
  color: [number, number, number];
  isDashed: boolean;
  isRejection: boolean;
  rejectionPhase: 'forward' | 'return';
  label: string;
}

interface RingEffect {
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  speed: number;
  intensity: number;
}

interface RejectionRecord {
  from: string;
  to: string;
  timestamp: number;
}

// ============================================================
// Constants
// ============================================================

const CFG = heroConfig.global;
const GRID_STEP = CFG.gridStepPx;
const D_MIN = CFG.specialNodeMinDistance;
const BOUNDARY_MARGIN = CFG.boundaryMargin;
const WAYPOINT_MIN = CFG.waypointMin;
const WAYPOINT_MAX = CFG.waypointMax;
const MAX_CONCURRENT = CFG.maxConcurrentPulses;
const STEP_DURATION = CFG.stepDurationMs;
const PULSE_SPEED_MIN = CFG.pulseSpeedMin;
const PULSE_SPEED_MAX = CFG.pulseSpeedMax;
const COOLDOWN_MIN = CFG.cooldownMinMs;
const COOLDOWN_MAX = CFG.cooldownMaxMs;
const LAMBDA = CFG.lambda;
const LAMBDA_RETRY = CFG.lambdaRetry;
const TRAIL_MAX_LENGTH = 32;
const CORE_RADIUS = 3;
const MOBILE_BREAKPOINT = 768;
const MOBILE_MAX_CONCURRENT = 3;
const MOBILE_SPECIAL_COUNT = 6;

const SPECIAL_NODE_SIZE = 14;
const SPECIAL_NODE_HOVER_RADIUS = 20;
const SPECIAL_NODE_CLICK_RADIUS = 25;
const PULSE_HOVER_RADIUS = 15;
const INTERACTION_RADIUS_HOVER = 100;
const INTERACTION_RADIUS_CLICK = 300;
const INTERACTION_STRENGTH_HOVER = 3;
const INTERACTION_STRENGTH_CLICK = 10;
const RING_BANDWIDTH = 150;
const RING_SIZE_BOOST = 6;
const RING_OPACITY_BOOST = 5;
const RING_MAX_SCALE_FACTOR = 0.4;
const RING_SPEED = 2.5;
const RING_INTENSITY = 1.0;
const LONG_PRESS_DELAY = 800;
const EDGE_GLOW_WIDTH = 6;
const EDGE_CORE_WIDTH = 2;
const EDGE_GLOW_OPACITY = 0.15;
const EDGE_CORE_OPACITY = 0.7;
const TANGENTIAL_STRENGTH = 3;
const RADIAL_STRENGTH = 7;
const SPRING_FACTOR = 0.1;
const MOBILE_DURATION_FACTOR = 0.66;

const PROTOCOL_STEPS = [
  { label: 'GET /.well-known/ocm', color: [138, 180, 248] as [number, number, number], dashed: true, forward: true },
  { label: '200 OK (discovery)', color: [52, 168, 83] as [number, number, number], dashed: true, forward: false },
  { label: 'POST /shares', color: [251, 188, 4] as [number, number, number], dashed: false, forward: true },
  { label: '201 Created', color: [52, 168, 83] as [number, number, number], dashed: false, forward: false },
];

const REJECTION_COLOR: [number, number, number] = [220, 50, 50];
const REJECTION_STEPS = [
  { label: 'GET /.well-known/ocm', color: REJECTION_COLOR, dashed: true, forward: true },
  { label: '403 Forbidden', color: REJECTION_COLOR, dashed: true, forward: false },
];

const CAPABILITY_COLORS: Record<string, string> = {
  'exchange-token': 'bg-blue-100 text-blue-800',
  'notifications': 'bg-green-100 text-green-800',
  'http-sig': 'bg-purple-100 text-purple-800',
  'invites': 'bg-amber-100 text-amber-800',
  'webdav-uri': 'bg-teal-100 text-teal-800',
};

// ============================================================
// Shader Source Code
// ============================================================

const VERTEX_SHADER = `#version 300 es
in vec2 a_position;
in float a_size;
in float a_opacity;
in float a_nodeType;
in vec3 a_fedColor;
in float a_hasFedColor;

uniform vec2 u_resolution;
uniform float u_time;
uniform float u_federationMode;

out float v_opacity;
out float v_nodeType;
out vec3 v_fedColor;
out float v_hasFedColor;

void main() {
  vec2 zeroToOne = a_position / u_resolution;
  vec2 zeroToTwo = zeroToOne * 2.0;
  vec2 clipSpace = zeroToTwo - 1.0;
  gl_Position = vec4(clipSpace * vec2(1, -1), 0, 1);

  float size = a_size;
  if (a_nodeType > 0.5) {
    size *= 1.0 + 0.15 * sin(u_time * 2.0 + a_position.x * 0.01 + a_position.y * 0.01);
  }
  gl_PointSize = size;

  v_opacity = min(a_opacity, 1.0);
  v_nodeType = a_nodeType;
  v_fedColor = mix(vec3(0.0), a_fedColor, u_federationMode);
  v_hasFedColor = a_hasFedColor;
}
`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;

in float v_opacity;
in float v_nodeType;
in vec3 v_fedColor;
in float v_hasFedColor;
out vec4 fragColor;

uniform sampler2D u_logoAtlas;
uniform bool u_hasLogoTexture;

float sdStar5(vec2 p, float r, float rf) {
  const vec2 k1 = vec2(0.809016994375, -0.587785252292);
  const vec2 k2 = vec2(-0.809016994375, -0.587785252292);
  p.x = abs(p.x);
  p -= 2.0 * max(dot(k1, p), 0.0) * k1;
  p -= 2.0 * max(dot(k2, p), 0.0) * k2;
  p.x = abs(p.x);
  p.y -= r;
  vec2 ba = rf * vec2(-k1.y, k1.x) - vec2(0, 1);
  float h = clamp(dot(p, ba) / dot(ba, ba), 0.0, r);
  return length(p - ba * h) * sign(p.y * ba.x - p.x * ba.y);
}

float sdHexagon(vec2 p, float r) {
  const vec3 k = vec3(-0.866025404, 0.5, 0.577350269);
  p = abs(p);
  p -= 2.0 * min(dot(k.xy, p), 0.0) * k.xy;
  p -= vec2(clamp(p.x, -k.z * r, k.z * r), r);
  p -= vec2(0.0, clamp(p.y, 0.0, r));
  return length(p);
}

float sdRhombus(vec2 p, vec2 b) {
  p = abs(p);
  float h = clamp((-2.0 * dot(p, b) + dot(b, b)) / dot(b, b), -1.0, 1.0);
  float d = length(p - 0.5 * b * h);
  return d * sign(p.x * b.y + p.y * b.x - b.x * b.y);
}

float sdCross(vec2 p, vec2 b, float r) {
  p = abs(p);
  p = (p.y > p.x) ? p.yx : p.xy;
  vec2 q = p - b;
  float d = min(length(max(q, 0.0)) + max(min(q.x, q.y), 0.0),
                length(max(p - b.yx, 0.0)) + max(min(p.x - b.y, 0.0), 0.0));
  return d - r;
}

float sdCircle(vec2 p, float r) {
  return length(p) - r;
}

float getSDF(vec2 p, float shapeId) {
  if (shapeId < 1.5) return sdStar5(p, 0.45, 0.38);
  if (shapeId < 2.5) return sdHexagon(p, 0.45);
  if (shapeId < 3.5) return sdRhombus(p, vec2(0.4, 0.55));
  if (shapeId < 4.5) return sdCross(p, vec2(0.35, 0.12), 0.02);
  return sdCircle(p, 0.45);
}

void main() {
  vec2 p = 2.0 * gl_PointCoord - 1.0;

  if (v_nodeType < 0.5) {
    float d = length(p) - 0.45;
    float alpha = 1.0 - smoothstep(0.0, 0.5, d);
    if (alpha < 0.01) discard;
    vec3 color = (v_hasFedColor > 0.5) ? v_fedColor : vec3(1.0, 1.0, 1.0);
    fragColor = vec4(color, alpha * v_opacity);
  } else if (v_nodeType < 5.5) {
    float d = getSDF(p, v_nodeType);
    float aa = fwidth(d) * 1.5;
    float alpha = 1.0 - smoothstep(-aa, aa, d);
    if (alpha < 0.01) discard;
    vec3 color = (v_hasFedColor > 0.5) ? v_fedColor : vec3(0.31, 0.76, 0.97);
    float core = 1.0 - smoothstep(0.0, 0.3, d);
    float glow = 1.0 - smoothstep(0.0, 0.8, d);
    vec3 finalColor = mix(color, vec3(0.95, 0.97, 1.0), core * 0.5);
    fragColor = vec4(finalColor, alpha * v_opacity);
  } else {
    if (u_hasLogoTexture) {
      vec2 uv = gl_PointCoord;
      vec4 tex = texture(u_logoAtlas, uv);
      if (tex.a < 0.05) discard;
      vec3 color = (v_hasFedColor > 0.5) ? mix(tex.rgb, v_fedColor, 0.5) : tex.rgb;
      fragColor = vec4(color * tex.a, tex.a * v_opacity);
    } else {
      float d = length(p);
      float alpha = 1.0 - smoothstep(0.85, 1.0, d);
      if (alpha < 0.01) discard;
      vec3 color = (v_hasFedColor > 0.5) ? v_fedColor : vec3(0.0, 0.2, 0.63);
      float ring = abs(d - 0.7);
      float ringAlpha = 1.0 - smoothstep(0.0, 0.08, ring);
      float core = 1.0 - smoothstep(0.0, 0.5, d);
      vec3 finalColor = mix(color, vec3(0.4, 0.6, 1.0), core * 0.3 + ringAlpha * 0.5);
      fragColor = vec4(finalColor, alpha * v_opacity);
    }
  }
}
`;

// ============================================================
// Utility Functions
// ============================================================

function expRandom(rate: number): number {
  return -Math.log(1.0 - Math.random()) / rate;
}

function selectSpecialNodes(
  rows: number,
  cols: number,
  k: number,
  dMin: number,
  boundary: number,
  exclusionZone?: { rowStartPct: number; rowEndPct: number; colStartPct: number; colEndPct: number },
  hubWeight: number = 3.0
): GridCoord[] {
  let currentDMin = dMin;
  const maxRetries = 10;

  const getWeight = (c: GridCoord) => ((c.i + c.j) % 2 === 1) ? hubWeight : 1.0;

  for (let retry = 0; retry < maxRetries; retry++) {
    const available: GridCoord[] = [];
    for (let i = boundary; i < rows - boundary; i++) {
      for (let j = boundary; j < cols - boundary; j++) {
        const inExclusion = exclusionZone &&
          i >= rows * exclusionZone.rowStartPct &&
          i <= rows * exclusionZone.rowEndPct &&
          j >= cols * exclusionZone.colStartPct &&
          j <= cols * exclusionZone.colEndPct;
        if (!inExclusion) {
          available.push({ i, j });
        }
      }
    }

    const chosen: GridCoord[] = [];

    while (chosen.length < k && available.length > 0) {
      const totalWeight = available.reduce((sum, c) => sum + getWeight(c), 0);
      let pick = Math.random() * totalWeight;
      let idx = 0;
      for (; idx < available.length; idx++) {
        pick -= getWeight(available[idx]);
        if (pick <= 0) break;
      }
      idx = Math.min(idx, available.length - 1);
      const candidate = available[idx];
      chosen.push(candidate);

      for (let a = available.length - 1; a >= 0; a--) {
        if (chebyshevDistance(available[a], candidate) < currentDMin) {
          available.splice(a, 1);
        }
      }
    }

    if (chosen.length >= k) {
      return chosen.slice(0, k);
    }

    currentDMin = Math.max(1, currentDMin - 1);
  }

  const fallback: GridCoord[] = [];
  for (let i = boundary; i < rows - boundary; i++) {
    for (let j = boundary; j < cols - boundary; j++) {
      const inExclusion = exclusionZone &&
        i >= rows * exclusionZone.rowStartPct &&
        i <= rows * exclusionZone.rowEndPct &&
        j >= cols * exclusionZone.colStartPct &&
        j <= cols * exclusionZone.colEndPct;
      if (!inExclusion) {
        fallback.push({ i, j });
      }
    }
  }

  const result: GridCoord[] = [];
  const pool = [...fallback];
  while (result.length < k && pool.length > 0) {
    const totalWeight = pool.reduce((sum, c) => sum + getWeight(c), 0);
    let pick = Math.random() * totalWeight;
    let idx = 0;
    for (; idx < pool.length; idx++) {
      pick -= getWeight(pool[idx]);
      if (pick <= 0) break;
    }
    idx = Math.min(idx, pool.length - 1);
    result.push(pool[idx]);
    pool.splice(idx, 1);
  }
  return result;
}

function findGraphPath(startNode: GridNode, endNode: GridNode, gridCols: number): MeshEdge[] {
  const queue: { node: GridNode; path: MeshEdge[] }[] = [{ node: startNode, path: [] }];
  const visited = new Set<number>();
  visited.add(startNode.i * gridCols + startNode.j);

  while (queue.length > 0) {
    const { node, path } = queue.shift()!;
    if (node === endNode) return path;

    for (const edge of node.edges) {
      const next = edge.fromNode === node ? edge.toNode : edge.fromNode;
      const key = next.i * gridCols + next.j;
      if (visited.has(key)) continue;
      if (next.specialIndex !== -1 && next !== endNode) continue;
      visited.add(key);
      queue.push({ node: next, path: [...path, edge] });
    }
  }
  return [];
}

function selectTarget(
  sourceIdx: number,
  specials: SpecialNodeRuntime[],
  configs: SpecialNodeConfig[]
): { targetIdx: number; isRejection: boolean } | null {
  const source = configs[sourceIdx];
  const otherIndices = configs
    .map((_, i) => i)
    .filter(i => i !== sourceIdx);

  if (otherIndices.length === 0) return null;

  let targetIdx: number;

  if (source.exclusive) {
    // Only pick from preferred neighbors
    const preferredIndices = source.preferredNeighbors
      .map(id => configs.findIndex(c => c.id === id))
      .filter(i => i >= 0 && i !== sourceIdx);
    if (preferredIndices.length === 0) return null;
    targetIdx = preferredIndices[Math.floor(Math.random() * preferredIndices.length)];
  } else if (source.preferredNeighbors.length > 0) {
    // 70% preferred, 30% random
    if (Math.random() < 0.7) {
      const preferredIndices = source.preferredNeighbors
        .map(id => configs.findIndex(c => c.id === id))
        .filter(i => i >= 0 && i !== sourceIdx);
      if (preferredIndices.length > 0) {
        targetIdx = preferredIndices[Math.floor(Math.random() * preferredIndices.length)];
      } else {
        targetIdx = otherIndices[Math.floor(Math.random() * otherIndices.length)];
      }
    } else {
      targetIdx = otherIndices[Math.floor(Math.random() * otherIndices.length)];
    }
  } else {
    // Uniform random
    targetIdx = otherIndices[Math.floor(Math.random() * otherIndices.length)];
  }

  // Check for 403 rejection
  const targetConfig = configs[targetIdx];
  if (targetConfig.exclusive) {
    const isInTargetPreferred = targetConfig.preferredNeighbors.includes(source.id);
    if (!isInTargetPreferred) {
      return { targetIdx, isRejection: true };
    }
  }

  return { targetIdx, isRejection: false };
}

function makeRing(x: number, y: number, maxDim: number): RingEffect {
  return {
    x,
    y,
    radius: 0,
    maxRadius: RING_MAX_SCALE_FACTOR * maxDim,
    speed: RING_SPEED,
    intensity: RING_INTENSITY,
  };
}

interface PulseStateForRollover {
  dyingTrail: TrailPoint[];
  trail: (TrailPoint | undefined)[];
  trailHeadIdx: number;
  dyingTrailGridPath: GridCoord[];
  dyingTrailAlpha: number;
  gridPath: GridCoord[];
}

function rolloverTrail(pulse: PulseStateForRollover): void {
  pulse.dyingTrail = [];
  for (let i = 0; i < TRAIL_MAX_LENGTH; i++) {
    const idx = (pulse.trailHeadIdx + i) % TRAIL_MAX_LENGTH;
    if (pulse.trail[idx]) pulse.dyingTrail.push({ ...pulse.trail[idx] });
  }
  pulse.dyingTrailGridPath = [...pulse.gridPath];
  pulse.dyingTrailAlpha = 1.0;
  pulse.trail = new Array(TRAIL_MAX_LENGTH);
  pulse.trailHeadIdx = 0;
}

// ============================================================
// WebGL Helpers
// ============================================================

function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error('Shader compile error:', gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function createProgram(
  gl: WebGL2RenderingContext,
  vs: string,
  fs: string
): WebGLProgram | null {
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vs);
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fs);
  if (!vertexShader || !fragmentShader) return null;

  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('Program link error:', gl.getProgramInfoLog(program));
    return null;
  }
  return program;
}

// ============================================================
// Component
// ============================================================

interface AnimationState {
  gl: WebGL2RenderingContext | null;
  program: WebGLProgram | null;
  logoTexture: WebGLTexture | null;
  logoTextureLoaded: boolean;
  width: number;
  height: number;
  time: number;
  dpr: number;
  grid: GridNode[];
  gridRows: number;
  gridCols: number;
  specials: SpecialNodeRuntime[];
  pulses: PulseState[];
  rings: RingEffect[];
  mouseX: number;
  mouseY: number;
  isPressed: boolean;
  globalActive: number;
  nextFireTimes: Map<number, number>;
  reducedMotion: boolean;
  federationMapMode: 'off' | 'sticky';
  lastFederationMode: 'off' | 'sticky';
  longPressTimer: ReturnType<typeof setTimeout> | null;
  pulseIdCounter: number;
  rejectionHistory: Map<string, RejectionRecord[]>;
  isMobile: boolean;
  maxConcurrent: number;
  specialNodeCount: number;
  posBuffer: WebGLBuffer | null;
  sizeBuffer: WebGLBuffer | null;
  opacityBuffer: WebGLBuffer | null;
  typeBuffer: WebGLBuffer | null;
  fedColorBuffer: WebGLBuffer | null;
  hasFedColorBuffer: WebGLBuffer | null;
  posArray: Float32Array;
  sizeArray: Float32Array;
  opacityArray: Float32Array;
  typeArray: Float32Array;
  fedColorArray: Float32Array;
  hasFedColorArray: Float32Array;
  lastTimestamp: number;
  activeSourceIndices: Set<number>;
  cachedMutualEdges: Array<[number, number]> | null;
  cachedFederatedIds: Set<string> | null;
  edges: MeshEdge[];
}

export default function ProtocolConstellation() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pulseCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animFrameRef = useRef<number>(0);
  const isMountedRef = useRef<boolean>(true);
  const lastConversationUpdateRef = useRef<number>(0);
  const labelRefs = useRef<(HTMLDivElement | null)[]>([]);
  const focusRef = useRef<HTMLDivElement | null>(null);
  const navRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const focusIndexRef = useRef(-1);
  const [selectedNode, setSelectedNode] = useState<SpecialNodeRuntime | null>(null);
  const [hoveredNode, setHoveredNode] = useState<SpecialNodeRuntime | null>(null);
  const [focusIndex, setFocusIndex] = useState(-1);
  useEffect(() => { focusIndexRef.current = focusIndex; }, [focusIndex]);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null);
  const [activeConversations, setActiveConversations] = useState<PulseState[]>([]);
  const [liveText, setLiveText] = useState('');
  const stateRef = useRef<AnimationState>({
    gl: null,
    program: null,
    logoTexture: null,
    logoTextureLoaded: false,
    width: 0,
    height: 0,
    time: 0,
    dpr: 1,
    grid: [],
    gridRows: 0,
    gridCols: 0,
    specials: [],
    pulses: [],
    rings: [],
    mouseX: -1000,
    mouseY: -1000,
    isPressed: false,
    globalActive: 0,
    nextFireTimes: new Map(),
    reducedMotion: false,
    federationMapMode: 'off',
    lastFederationMode: 'off',
    longPressTimer: null,
    pulseIdCounter: 0,
    rejectionHistory: new Map(),
    isMobile: false,
    maxConcurrent: MAX_CONCURRENT,
    specialNodeCount: heroConfig.specialNodes.length,
    posBuffer: null,
    sizeBuffer: null,
    opacityBuffer: null,
    typeBuffer: null,
    fedColorBuffer: null,
    hasFedColorBuffer: null,
    posArray: new Float32Array(0),
    sizeArray: new Float32Array(0),
    opacityArray: new Float32Array(0),
    typeArray: new Float32Array(0),
    fedColorArray: new Float32Array(0),
    hasFedColorArray: new Float32Array(0),
    lastTimestamp: 0,
    activeSourceIndices: new Set(),
    cachedMutualEdges: null,
    cachedFederatedIds: null,
    edges: [],
  });

  const configs = heroConfig.specialNodes;

  const buildGrid = useCallback((width: number, height: number) => {
    const state = stateRef.current;
    const isMobile = width < MOBILE_BREAKPOINT;
    const k = isMobile ? Math.min(MOBILE_SPECIAL_COUNT, configs.length) : configs.length;
    const gridStep = GRID_STEP;
    const nodeEdgeGap = heroConfig.global.nodeEdgeGap;

    const rows = Math.floor(height / gridStep);
    const cols = Math.floor(width / gridStep);

    const grid: GridNode[] = [];
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        const jitterX = (Math.random() - 0.5) * 4;
        const jitterY = (Math.random() - 0.5) * 4;
        const x = j * gridStep + gridStep / 2 + jitterX;
        const y = i * gridStep + gridStep / 2 + jitterY;
        grid.push({
          i, j,
          x, y,
          baseX: x, baseY: y,
          size: 2.5,
          baseSize: 2.5,
          targetSize: 2.5,
          opacity: 0.3 + Math.random() * 0.2,
          baseOpacity: 0.3 + Math.random() * 0.2,
          nodeType: 0,
          specialIndex: -1,
          fedColor: null,
          isHub: (i + j) % 2 === 1,
          edges: [],
        });
      }
    }

    const edges: MeshEdge[] = [];
    const edgeKeys = new Set<string>();

    const addEdge = (fromIdx: number, toIdx: number, type: MeshEdge['edgeType'], diagDir: MeshEdge['diagonalDir']) => {
      if (fromIdx === toIdx) return;
      const key = fromIdx < toIdx ? `${fromIdx}-${toIdx}` : `${toIdx}-${fromIdx}`;
      if (edgeKeys.has(key)) return;

      const fromNode = grid[fromIdx];
      const toNode = grid[toIdx];
      const edge: MeshEdge = {
        fromNode,
        toNode,
        fromIdx,
        toIdx,
        edgeType: type,
        diagonalDir: diagDir,
        visible: false,
        fedColor: null,
        opacity: 0,
        baseOpacity: 0,
      };

      edges.push(edge);
      edgeKeys.add(key);
      fromNode.edges.push(edge);
      toNode.edges.push(edge);
    };

    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols - 1; j++) {
        addEdge(i * cols + j, i * cols + (j + 1), 'horizontal', null);
      }
    }

    for (let i = 0; i < rows - 1; i++) {
      for (let j = 0; j < cols; j++) {
        addEdge(i * cols + j, (i + 1) * cols + j, 'vertical', null);
      }
    }

    for (let r = 0; r < rows - 1; r++) {
      for (let j = 0; j < cols - 1; j++) {
        if ((r + j) % 2 === 0) {
          addEdge(r * cols + (j + 1), (r + 1) * cols + j, 'diagonal', '/');
        } else {
          addEdge(r * cols + j, (r + 1) * cols + (j + 1), 'diagonal', '\\');
        }
      }
    }

    const positions = selectSpecialNodes(
      rows, cols, k, D_MIN, BOUNDARY_MARGIN,
      heroConfig.global.exclusionZone,
      heroConfig.global.hubWeight
    );
    const specials: SpecialNodeRuntime[] = [];

    for (let si = 0; si < positions.length && si < configs.length; si++) {
      const pos = positions[si];
      const config = configs[si];
      const gridIdx = pos.i * cols + pos.j;
      if (gridIdx >= 0 && gridIdx < grid.length) {
        const nodeType = config.iconType === 'logo' ? 6 : (config.shapeId ?? 1);
        grid[gridIdx].nodeType = nodeType;
        grid[gridIdx].specialIndex = si;
        grid[gridIdx].size = SPECIAL_NODE_SIZE;
        grid[gridIdx].baseSize = SPECIAL_NODE_SIZE;
        grid[gridIdx].opacity = 0.9;
        grid[gridIdx].baseOpacity = 0.9;

        specials.push({
          ...config,
          gridI: pos.i,
          gridJ: pos.j,
          screenX: grid[gridIdx].baseX,
          screenY: grid[gridIdx].baseY,
          nodeType,
        });
      }
    }

    state.grid = grid;
    state.gridRows = rows;
    state.gridCols = cols;
    state.specials = specials;

    const nodeCount = grid.length;
    state.posArray = new Float32Array(nodeCount * 2);
    state.sizeArray = new Float32Array(nodeCount);
    state.opacityArray = new Float32Array(nodeCount);
    state.typeArray = new Float32Array(nodeCount);
    state.fedColorArray = new Float32Array(nodeCount * 3);
    state.hasFedColorArray = new Float32Array(nodeCount);

    state.edges = edges;

    invalidateFederationCache(state);
    state.isMobile = isMobile;
    state.maxConcurrent = isMobile ? MOBILE_MAX_CONCURRENT : MAX_CONCURRENT;
    state.specialNodeCount = specials.length;
  }, [configs]);

  // ---- WebGL Initialization ----
  const initWebGL = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return false;

    const gl = canvas.getContext('webgl2', { alpha: true, antialias: true, desynchronized: true });
    if (!gl) return false;

    const program = createProgram(gl, VERTEX_SHADER, FRAGMENT_SHADER);
    if (!program) return false;

    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);

    const posBuffer = gl.createBuffer();
    const sizeBuffer = gl.createBuffer();
    const opacityBuffer = gl.createBuffer();
    const typeBuffer = gl.createBuffer();
    const fedColorBuffer = gl.createBuffer();
    const hasFedColorBuffer = gl.createBuffer();

    const state = stateRef.current;
    state.gl = gl;
    state.program = program;
    state.posBuffer = posBuffer;
    state.sizeBuffer = sizeBuffer;
    state.opacityBuffer = opacityBuffer;
    state.typeBuffer = typeBuffer;
    state.fedColorBuffer = fedColorBuffer;
    state.hasFedColorBuffer = hasFedColorBuffer;
    state.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    return true;
  }, []);

  // ---- Federation Cache Helpers ----
  function ensureFederationCache(state: AnimationState) {
    if (!state.cachedMutualEdges) {
      const edges: Array<[number, number]> = [];
      for (let i = 0; i < state.specials.length; i++) {
        for (let j = i + 1; j < state.specials.length; j++) {
          const a = state.specials[i];
          const b = state.specials[j];
          if (a.preferredNeighbors.includes(b.id) && b.preferredNeighbors.includes(a.id)) {
            edges.push([i, j]);
          }
        }
      }
      state.cachedMutualEdges = edges;
    }
    if (!state.cachedFederatedIds) {
      const fedIds = new Set<string>();
      for (const special of state.specials) {
        for (const other of state.specials) {
          if (other.id !== special.id &&
              special.preferredNeighbors.includes(other.id) &&
              other.preferredNeighbors.includes(special.id)) {
            fedIds.add(special.id);
            break;
          }
        }
      }
      state.cachedFederatedIds = fedIds;
    }
  }

  function invalidateFederationCache(state: AnimationState) {
    state.cachedMutualEdges = null;
    state.cachedFederatedIds = null;
  }

  function updateFederationPaths(state: AnimationState) {
    for (const node of state.grid) {
      node.fedColor = null;
    }
    for (const edge of state.edges) {
      edge.visible = false;
      edge.fedColor = null;
    }
    if (state.federationMapMode === 'off') return;

    ensureFederationCache(state);
    const mutualEdges = state.cachedMutualEdges!;
    const fedColor: [number, number, number] = [52, 168, 83];
    const grayColor: [number, number, number] = [128, 128, 128];

    for (const [i, j] of mutualEdges) {
      const a = state.specials[i];
      const b = state.specials[j];
      const startNode = state.grid[a.gridI * state.gridCols + a.gridJ];
      const endNode = state.grid[b.gridI * state.gridCols + b.gridJ];
      const path = findGraphPath(startNode, endNode, state.gridCols);

      if (path.length > 0) {
        for (const edge of path) {
          edge.fedColor = fedColor;
          edge.visible = true;
          edge.fromNode.fedColor = fedColor;
          edge.toNode.fedColor = fedColor;
          edge.fromNode.targetSize = Math.max(edge.fromNode.targetSize, edge.fromNode.baseSize * 2.5);
          edge.toNode.targetSize = Math.max(edge.toNode.targetSize, edge.toNode.baseSize * 2.5);
        }

      }
    }

    for (const special of state.specials) {
      if (!state.cachedFederatedIds?.has(special.id)) {
        const idx = special.gridI * state.gridCols + special.gridJ;
        if (idx >= 0 && idx < state.grid.length && !state.grid[idx].fedColor) {
          state.grid[idx].fedColor = grayColor;
        }
      }
    }

    for (let i = 0; i < state.specials.length; i++) {
      for (let j = i + 1; j < state.specials.length; j++) {
        const a = state.specials[i];
        const b = state.specials[j];
        const isMutual = a.preferredNeighbors.includes(b.id) && b.preferredNeighbors.includes(a.id);
        if (isMutual) continue;
        const isPreferred = a.preferredNeighbors.includes(b.id) || b.preferredNeighbors.includes(a.id);
        if (!isPreferred) continue;
        const startNode = state.grid[a.gridI * state.gridCols + a.gridJ];
        const endNode = state.grid[b.gridI * state.gridCols + b.gridJ];
        const path = findGraphPath(startNode, endNode, state.gridCols);
        if (path.length > 0) {
          for (const edge of path) {
            if (!edge.fedColor) {
              edge.fedColor = grayColor;
              edge.visible = true;
              edge.fromNode.fedColor = grayColor;
              edge.toNode.fedColor = grayColor;
              edge.fromNode.targetSize = Math.max(edge.fromNode.targetSize, edge.fromNode.baseSize * 2.5);
              edge.toNode.targetSize = Math.max(edge.toNode.targetSize, edge.toNode.baseSize * 2.5);
            }
          }

        }
      }
    }
  }

  // ---- Logo Texture Loading ----
  const loadLogoTexture = useCallback(() => {
    const state = stateRef.current;
    const gl = state.gl;
    if (!gl) return;

    const basePath = import.meta.env.BASE_URL || '/';
    const logoUrl = `${basePath}images/cern.svg`;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (!gl) return;
      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 64;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, 64, 64);
      ctx.drawImage(img, 0, 0, 64, 64);

      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

      state.logoTexture = texture;
      state.logoTextureLoaded = true;
    };
    img.onerror = () => {
      // Fallback: use SDF circle for logo nodes
      state.logoTextureLoaded = false;
    };
    img.src = logoUrl;
  }, []);

  // ---- Resize Handler ----
  const resize = useCallback(() => {
    const canvas = canvasRef.current;
    const pulseCanvas = pulseCanvasRef.current;
    const container = containerRef.current;
    if (!canvas || !pulseCanvas || !container) return;

    const state = stateRef.current;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    state.dpr = dpr;

    const rect = container.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';

    pulseCanvas.width = width * dpr;
    pulseCanvas.height = height * dpr;
    pulseCanvas.style.width = width + 'px';
    pulseCanvas.style.height = height + 'px';

    state.width = width;
    state.height = height;
    state.isMobile = width < MOBILE_BREAKPOINT;
    state.maxConcurrent = state.isMobile ? MOBILE_MAX_CONCURRENT : MAX_CONCURRENT;

    const gl = state.gl;
    if (gl) {
      gl.viewport(0, 0, canvas.width, canvas.height);
    }
  }, []);

  // ---- Pulse Management ----
  const spawnPulse = useCallback((sourceIdx: number): boolean => {
    const state = stateRef.current;
    if (state.globalActive >= state.maxConcurrent) return false;
    if (sourceIdx < 0 || sourceIdx >= state.specials.length) return false;
    if (state.activeSourceIndices.has(sourceIdx)) return false;

    const targetResult = selectTarget(sourceIdx, state.specials, configs);
    if (!targetResult) return false;

    const { targetIdx, isRejection } = targetResult;
    const source = state.specials[sourceIdx];
    const target = state.specials[targetIdx];

    const startGrid = { i: source.gridI, j: source.gridJ };
    const endGrid = { i: target.gridI, j: target.gridJ };

    const { gridPath } = selectWaypointsWithConstraints(startGrid, endGrid, WAYPOINT_MIN, WAYPOINT_MAX, D_MIN, state.gridRows, state.gridCols, state.grid);

    const pulseId = state.pulseIdCounter++;
    const speedFactor = PULSE_SPEED_MIN + Math.random() * (PULSE_SPEED_MAX - PULSE_SPEED_MIN);
    const baseDuration = state.isMobile ? STEP_DURATION * MOBILE_DURATION_FACTOR : STEP_DURATION;
    const stepDuration = baseDuration / speedFactor;

    if (isRejection) {
      const step = REJECTION_STEPS[0];
      const pulse: PulseState = {
        id: pulseId,
        fromIdx: sourceIdx,
        toIdx: targetIdx,
        stepIndex: 0,
        progress: 0,
        speedFactor,
        stepDuration,
        gridPath: gridPath,
        trail: new Array(TRAIL_MAX_LENGTH),
        trailHeadIdx: 0,
        dyingTrail: [],
        dyingTrailAlpha: 0,
        dyingTrailGridPath: [],
        color: step.color,
        isDashed: step.dashed,
        isRejection: true,
        rejectionPhase: step.forward ? 'forward' : 'return',
        label: step.label,
      };
      state.pulses.push(pulse);
      state.globalActive++;
      state.activeSourceIndices.add(sourceIdx);

      // Record rejection bidirectionally
      const record = { from: source.id, to: target.id, timestamp: Date.now() };
      const targetHistory = state.rejectionHistory.get(target.id) || [];
      targetHistory.push(record);
      if (targetHistory.length > 5) targetHistory.shift();
      state.rejectionHistory.set(target.id, targetHistory);

      const sourceHistory = state.rejectionHistory.get(source.id) || [];
      sourceHistory.push(record);
      if (sourceHistory.length > 5) sourceHistory.shift();
      state.rejectionHistory.set(source.id, sourceHistory);

      setLiveText(`${source.org} (${source.software}) is sending GET /.well-known/ocm to ${target.org} - 403 expected`);
    } else {
      // Normal protocol pulse
      const step = PROTOCOL_STEPS[0];
      const pulse: PulseState = {
        id: pulseId,
        fromIdx: sourceIdx,
        toIdx: targetIdx,
        stepIndex: 0,
        progress: 0,
        speedFactor,
        stepDuration,
        gridPath: gridPath,
        trail: new Array(TRAIL_MAX_LENGTH),
        trailHeadIdx: 0,
        dyingTrail: [],
        dyingTrailAlpha: 0,
        dyingTrailGridPath: [],
        color: step.color,
        isDashed: step.dashed,
        isRejection: false,
        rejectionPhase: 'forward',
        label: step.label,
      };
      state.pulses.push(pulse);
      state.globalActive++;
      state.activeSourceIndices.add(sourceIdx);

      const direction = step.forward ? source : target;
      const other = step.forward ? target : source;
      setLiveText(`${direction.org} (${direction.software}) is sending ${step.label} to ${other.org}`);
    }
    return true;
  }, [configs]);

  const computeNewPath = useCallback((
    fromIdx: number,
    toIdx: number,
    forward: boolean
  ): GridCoord[] => {
    const state = stateRef.current;
    const source = forward ? state.specials[fromIdx] : state.specials[toIdx];
    const target = forward ? state.specials[toIdx] : state.specials[fromIdx];

    const startGrid = { i: source.gridI, j: source.gridJ };
    const endGrid = { i: target.gridI, j: target.gridJ };

    const { gridPath } = selectWaypointsWithConstraints(startGrid, endGrid, WAYPOINT_MIN, WAYPOINT_MAX, D_MIN, state.gridRows, state.gridCols, state.grid);
    return gridPath;
  }, []);

  const updatePulses = useCallback((dt: number) => {
    const state = stateRef.current;

    state.pulses = state.pulses.filter(pulse => {
      pulse.progress += dt / pulse.stepDuration;

      // Fade dying trail
      if (pulse.dyingTrailAlpha > 0) {
        pulse.dyingTrailAlpha -= 0.1;
        if (pulse.dyingTrailAlpha < 0) pulse.dyingTrailAlpha = 0;
      }

      // Add current position to trail (ring buffer)
      const totalSegs = Math.max(1, pulse.gridPath.length - 1);
      const exactIdx = pulse.progress * totalSegs;
      const segIdx = Math.min(Math.floor(exactIdx), totalSegs - 1);
      const frac = exactIdx - segIdx;
      pulse.trail[pulse.trailHeadIdx] = { segIdx, frac };
      pulse.trailHeadIdx = (pulse.trailHeadIdx + 1) % TRAIL_MAX_LENGTH;

      if (pulse.progress >= 1.0) {
        // Step complete
        if (pulse.isRejection) {
          const maxSteps = REJECTION_STEPS.length;
          pulse.stepIndex++;

          if (pulse.stepIndex >= maxSteps) {
            state.globalActive--;
            state.activeSourceIndices.delete(pulse.fromIdx);
            return false;
          }

          const step = REJECTION_STEPS[pulse.stepIndex];
          pulse.rejectionPhase = step.forward ? 'forward' : 'return';
          pulse.progress = 0;
          rolloverTrail(pulse);
          pulse.gridPath = computeNewPath(pulse.fromIdx, pulse.toIdx, step.forward);
          pulse.color = step.color;
          pulse.isDashed = step.dashed;
          pulse.label = step.label;

          const source = state.specials[pulse.fromIdx];
          const target = state.specials[pulse.toIdx];
          setLiveText(`${target.org} rejected request from ${source.org}: ${step.label}`);
          return true;
        } else {
          // Normal protocol: 4 steps (or 3 on mobile)
          const maxSteps = state.isMobile ? 3 : 4;
          pulse.stepIndex++;

          if (pulse.stepIndex >= maxSteps) {
            // Protocol complete
            state.globalActive--;
            state.activeSourceIndices.delete(pulse.fromIdx);
            return false;
          }

          // Mobile skips discovery response (step 1)
          const effectiveStep = state.isMobile && pulse.stepIndex >= 1
            ? pulse.stepIndex + 1
            : pulse.stepIndex;

          const step = PROTOCOL_STEPS[effectiveStep] || PROTOCOL_STEPS[PROTOCOL_STEPS.length - 1];
          pulse.progress = 0;
          rolloverTrail(pulse);
          pulse.color = step.color;
          pulse.isDashed = step.dashed;
          pulse.label = step.label;
          pulse.gridPath = computeNewPath(pulse.fromIdx, pulse.toIdx, step.forward);

          const source = state.specials[pulse.fromIdx];
          const target = state.specials[pulse.toIdx];
          const direction = step.forward ? source : target;
          const other = step.forward ? target : source;
          setLiveText(`${direction.org} (${direction.software}) is sending ${step.label} to ${other.org}`);
        }
      }

      return true;
    });
  }, [computeNewPath]);

  const schedulePulses = useCallback(() => {
    const state = stateRef.current;
    const now = performance.now();

    for (let si = 0; si < state.specials.length; si++) {
      let nextTime = state.nextFireTimes.get(si);
      if (!nextTime) {
        nextTime = now + expRandom(LAMBDA) * 1000;
        state.nextFireTimes.set(si, nextTime);
      }

      if (now >= nextTime) {
        const spawned = state.globalActive < state.maxConcurrent;
        if (spawned) {
          const pulseSpawned = spawnPulse(si);
          if (pulseSpawned) {
            const isRejection = state.pulses[state.pulses.length - 1]?.isRejection;
            const nextDelay = isRejection
              ? expRandom(LAMBDA_RETRY) * 1000
              : COOLDOWN_MIN + Math.random() * (COOLDOWN_MAX - COOLDOWN_MIN);
            state.nextFireTimes.set(si, now + nextDelay);
          } else {
            // Spawn failed (e.g., no valid target) — retry soon
            state.nextFireTimes.set(si, now + expRandom(LAMBDA_RETRY) * 1000);
          }
        } else {
          state.nextFireTimes.set(si, now + expRandom(LAMBDA_RETRY) * 1000);
        }
      }
    }
  }, [spawnPulse]);

  // ---- Rendering ----
  const renderNodes = useCallback(() => {
    const state = stateRef.current;
    const gl = state.gl;
    const program = state.program;
    if (!gl || !program) return;

    gl.useProgram(program);

    const nodeCount = state.grid.length;
    const posArray = state.posArray;
    const sizeArray = state.sizeArray;
    const opacityArray = state.opacityArray;
    const typeArray = state.typeArray;
    const fedColorArray = state.fedColorArray;
    const hasFedColorArray = state.hasFedColorArray;

    let pi = 0;
    let fi = 0;
    let hi = 0;
    for (let i = 0; i < nodeCount; i++) {
      const node = state.grid[i];
      posArray[pi++] = node.x * state.dpr;
      posArray[pi++] = node.y * state.dpr;
      sizeArray[i] = node.size * state.dpr;
      opacityArray[i] = node.opacity;
      typeArray[i] = node.nodeType;
    }

    const fedMode = state.federationMapMode !== 'off';
    if (fedMode) ensureFederationCache(state);
    for (let i = 0; i < nodeCount; i++) {
      const node = state.grid[i];
      if (fedMode && node.fedColor) {
        hasFedColorArray[hi++] = 1.0;
        fedColorArray[fi++] = node.fedColor[0] / 255;
        fedColorArray[fi++] = node.fedColor[1] / 255;
        fedColorArray[fi++] = node.fedColor[2] / 255;
      } else {
        hasFedColorArray[hi++] = 0.0;
        fedColorArray[fi++] = 0;
        fedColorArray[fi++] = 0;
        fedColorArray[fi++] = 0;
      }
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, state.posBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, posArray, gl.DYNAMIC_DRAW);
    const posLoc = gl.getAttribLocation(program, 'a_position');
    if (posLoc >= 0) {
      gl.enableVertexAttribArray(posLoc);
      gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, state.sizeBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, sizeArray, gl.DYNAMIC_DRAW);
    const sizeLoc = gl.getAttribLocation(program, 'a_size');
    if (sizeLoc >= 0) {
      gl.enableVertexAttribArray(sizeLoc);
      gl.vertexAttribPointer(sizeLoc, 1, gl.FLOAT, false, 0, 0);
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, state.opacityBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, opacityArray, gl.DYNAMIC_DRAW);
    const opacityLoc = gl.getAttribLocation(program, 'a_opacity');
    if (opacityLoc >= 0) {
      gl.enableVertexAttribArray(opacityLoc);
      gl.vertexAttribPointer(opacityLoc, 1, gl.FLOAT, false, 0, 0);
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, state.typeBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, typeArray, gl.DYNAMIC_DRAW);
    const typeLoc = gl.getAttribLocation(program, 'a_nodeType');
    if (typeLoc >= 0) {
      gl.enableVertexAttribArray(typeLoc);
      gl.vertexAttribPointer(typeLoc, 1, gl.FLOAT, false, 0, 0);
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, state.fedColorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, fedColorArray, gl.DYNAMIC_DRAW);
    const fedColorLoc = gl.getAttribLocation(program, 'a_fedColor');
    if (fedColorLoc >= 0) {
      gl.enableVertexAttribArray(fedColorLoc);
      gl.vertexAttribPointer(fedColorLoc, 3, gl.FLOAT, false, 0, 0);
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, state.hasFedColorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, hasFedColorArray, gl.DYNAMIC_DRAW);
    const hasFedColorLoc = gl.getAttribLocation(program, 'a_hasFedColor');
    if (hasFedColorLoc >= 0) {
      gl.enableVertexAttribArray(hasFedColorLoc);
      gl.vertexAttribPointer(hasFedColorLoc, 1, gl.FLOAT, false, 0, 0);
    }

    const resolutionLoc = gl.getUniformLocation(program, 'u_resolution');
    gl.uniform2f(resolutionLoc, state.width * state.dpr, state.height * state.dpr);
    const timeLoc = gl.getUniformLocation(program, 'u_time');
    gl.uniform1f(timeLoc, state.time * 0.001);
    const fedModeLoc = gl.getUniformLocation(program, 'u_federationMode');
    gl.uniform1f(fedModeLoc, state.federationMapMode !== 'off' ? 1.0 : 0.0);

    const hasLogoLoc = gl.getUniformLocation(program, 'u_hasLogoTexture');
    if (state.logoTextureLoaded && state.logoTexture) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, state.logoTexture);
      const atlasLoc = gl.getUniformLocation(program, 'u_logoAtlas');
      gl.uniform1i(atlasLoc, 0);
      gl.uniform1i(hasLogoLoc, 1);
    } else {
      gl.uniform1i(hasLogoLoc, 0);
    }

    gl.drawArrays(gl.POINTS, 0, nodeCount);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }, []);

  const renderPulseTrails = useCallback(() => {
    const state = stateRef.current;
    const canvas = pulseCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.save();
    ctx.scale(state.dpr, state.dpr);

    for (const pulse of state.pulses) {
      // Render dying trail (fading old trail during step transitions)
      if (pulse.dyingTrail.length >= 2 && pulse.dyingTrailAlpha > 0) {
        const dn = pulse.dyingTrail.length;
        for (let i = 0; i < dn - 1; i++) {
          const frac = i / (dn - 1);
          const alpha = frac * 0.45 * pulse.dyingTrailAlpha;
          const p1 = resolveTrailPoint(pulse.dyingTrail[i], pulse.dyingTrailGridPath, state.grid, state.gridCols);
          const p2 = resolveTrailPoint(pulse.dyingTrail[i + 1], pulse.dyingTrailGridPath, state.grid, state.gridCols);
          ctx.beginPath();
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.strokeStyle = `rgba(${pulse.color.join(',')},${alpha})`;
          ctx.lineWidth = 1.0 + frac * 3.0;
          ctx.lineCap = 'round';
          ctx.setLineDash([]);
          ctx.stroke();
        }
      }

      // Extract valid trail points from ring buffer in order
      const trailPts: TrailPoint[] = [];
      for (let i = 0; i < TRAIL_MAX_LENGTH; i++) {
        const idx = (pulse.trailHeadIdx + i) % TRAIL_MAX_LENGTH;
        if (pulse.trail[idx]) {
          trailPts.push(pulse.trail[idx]);
        }
      }
      if (trailPts.length < 2) continue;

      const n = trailPts.length;

      for (let i = 0; i < n - 1; i++) {
        const frac = i / (n - 1);
        const alpha = frac * 0.45;
        const width = 1.0 + frac * 3.0;

        const cool: [number, number, number] = [80, 140, 255];
        const hot = pulse.color;
        const r = Math.round(cool[0] + (hot[0] - cool[0]) * frac);
        const g = Math.round(cool[1] + (hot[1] - cool[1]) * frac);
        const b = Math.round(cool[2] + (hot[2] - cool[2]) * frac);

        const p1 = resolveTrailPoint(trailPts[i], pulse.gridPath, state.grid, state.gridCols);
        const p2 = resolveTrailPoint(trailPts[i + 1], pulse.gridPath, state.grid, state.gridCols);

        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.strokeStyle = `rgba(${r},${g},${b},${alpha})`;
        ctx.lineWidth = width;
        ctx.lineCap = 'round';

        if (pulse.isDashed) {
          ctx.setLineDash([8, 12]);
          ctx.lineDashOffset = -frac * 20;
        } else {
          ctx.setLineDash([]);
        }

        ctx.stroke();
      }

      const head = resolveTrailPoint(trailPts[n - 1], pulse.gridPath, state.grid, state.gridCols);
      const glowRadius = 16;
      const gradient = ctx.createRadialGradient(
        head.x, head.y, 0,
        head.x, head.y, glowRadius
      );
      gradient.addColorStop(0, `rgba(${pulse.color.join(',')},0.7)`);
      gradient.addColorStop(0.35, `rgba(${pulse.color.join(',')},0.2)`);
      gradient.addColorStop(1, 'rgba(0,0,0,0)');

      ctx.beginPath();
      ctx.arc(head.x, head.y, glowRadius, 0, Math.PI * 2);
      ctx.fillStyle = gradient;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(head.x, head.y, CORE_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fill();

      // Step badge
      ctx.font = 'bold 11px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      if (pulse.isRejection && pulse.stepIndex >= 1) {
        ctx.fillStyle = 'rgba(220,50,50,0.9)';
        ctx.fillText('403', head.x, head.y - 14);
      } else if (!pulse.isRejection) {
        ctx.fillStyle = `rgba(${pulse.color.join(',')},0.9)`;
        const stepLabel = `S${pulse.stepIndex + 1}`;
        ctx.fillText(stepLabel, head.x, head.y - 14);
      }
    }

    ctx.restore();
  }, []);

  const renderEdges = useCallback(() => {
    const state = stateRef.current;
    const canvas = pulseCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(state.dpr, state.dpr);

    const showIdle = heroConfig.global.showIdleEdges;
    const idleOpacity = heroConfig.global.idleEdgeOpacity;
    const nodeEdgeGap = heroConfig.global.nodeEdgeGap;

    for (const edge of state.edges) {
      const fromNode = edge.fromNode;
      const toNode = edge.toNode;
      const dx = toNode.x - fromNode.x;
      const dy = toNode.y - fromNode.y;
      const len = Math.hypot(dx, dy);
      if (len === 0) continue;

      const ux = dx / len;
      const uy = dy / len;
      const fromRadius = fromNode.size / 2 + nodeEdgeGap;
      const toRadius = toNode.size / 2 + nodeEdgeGap;
      const fx = fromNode.x + ux * fromRadius;
      const fy = fromNode.y + uy * fromRadius;
      const tx = toNode.x - ux * toRadius;
      const ty = toNode.y - uy * toRadius;

      if (edge.visible && edge.fedColor) {
        const [r, g, b] = edge.fedColor;
        const isGray = r === 128 && g === 128 && b === 128;

        ctx.beginPath();
        ctx.moveTo(fx, fy);
        ctx.lineTo(tx, ty);
        ctx.strokeStyle = `rgba(${r},${g},${b},0.15)`;
        ctx.lineWidth = 6;
        ctx.lineCap = 'round';
        if (isGray) ctx.setLineDash([4, 6]);
        ctx.stroke();
        if (isGray) ctx.setLineDash([]);

        ctx.beginPath();
        ctx.moveTo(fx, fy);
        ctx.lineTo(tx, ty);
        ctx.strokeStyle = `rgba(${r},${g},${b},0.7)`;
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        if (isGray) ctx.setLineDash([2, 4]);
        ctx.stroke();
        if (isGray) ctx.setLineDash([]);
      } else if (showIdle && idleOpacity > 0) {
        ctx.beginPath();
        ctx.moveTo(fx, fy);
        ctx.lineTo(tx, ty);
        ctx.strokeStyle = `rgba(128,128,128,${idleOpacity})`;
        ctx.lineWidth = 0.5;
        ctx.stroke();
      }
    }

    ctx.restore();
  }, []);

  // ---- Animation Loop ----
  const animate = useCallback((timestamp: number) => {
    if (!isMountedRef.current) return;
    const state = stateRef.current;
    const gl = state.gl;
    if (!gl) return;

    const dt = state.lastTimestamp ? Math.min(timestamp - state.lastTimestamp, 50) : 16;
    state.lastTimestamp = timestamp;
    state.time = timestamp;

    if (state.reducedMotion) {
      if (state.federationMapMode !== state.lastFederationMode) {
        state.lastFederationMode = state.federationMapMode;
        updateFederationPaths(state);
      }
      gl.clear(gl.COLOR_BUFFER_BIT);
      renderNodes();
      renderEdges();
      renderPulseTrails();
      return;
    }

    // Update mouse interaction (elastic field)
    const interactionRadius = state.isPressed ? INTERACTION_RADIUS_CLICK : INTERACTION_RADIUS_HOVER;
    const interactionStrength = state.isPressed ? INTERACTION_STRENGTH_CLICK : INTERACTION_STRENGTH_HOVER;

    for (const node of state.grid) {
      const dx = state.mouseX - node.baseX;
      const dy = state.mouseY - node.baseY;
      const d = Math.sqrt(dx * dx + dy * dy);

      if (d <= interactionRadius && d > 0) {
        const s = (1 - d / interactionRadius) * interactionStrength;
        const targetX = node.baseX + (dx / d) * s;
        const targetY = node.baseY + (dy / d) * s;
        node.x += (targetX - node.x) * SPRING_FACTOR;
        node.y += (targetY - node.y) * SPRING_FACTOR;
      } else {
        node.x += (node.baseX - node.x) * SPRING_FACTOR;
        node.y += (node.baseY - node.y) * SPRING_FACTOR;
      }
    }

    // Ring effects
    for (const ring of state.rings) {
      ring.radius = Math.min(ring.radius + ring.speed, ring.maxRadius);
      const progress = ring.radius / ring.maxRadius;
      ring.intensity = Math.pow(1 - progress, 1.5);
    }
    state.rings = state.rings.filter(r => r.radius < r.maxRadius);

    // Apply ring influence with tangential swirl
    for (const ring of state.rings) {
      for (const node of state.grid) {
        const distToCenter = Math.sqrt((node.x - ring.x) ** 2 + (node.y - ring.y) ** 2);
        const band = Math.abs(distToCenter - ring.radius);
        if (band <= RING_BANDWIDTH) {
          const l = 0.5 * Math.cos((band / RING_BANDWIDTH) * Math.PI) + 0.5;
          const timeAngle = 0.001 * state.time;
          const tangentialStrength = TANGENTIAL_STRENGTH * l * ring.intensity;
          node.x += Math.cos(timeAngle) * tangentialStrength;
          node.y += Math.sin(timeAngle) * tangentialStrength;
          const outwardAngle = Math.atan2(node.y - ring.y, node.x - ring.x);
          const outwardStrength = l * ring.intensity * RADIAL_STRENGTH;
          node.x += Math.cos(outwardAngle) * outwardStrength;
          node.y += Math.sin(outwardAngle) * outwardStrength;
          node.targetSize = Math.max(node.targetSize, node.baseSize + RING_SIZE_BOOST * l * ring.intensity);
          node.opacity = Math.min(1, node.opacity + RING_OPACITY_BOOST * l * ring.intensity);
        }
      }
    }

    // Decay dot sizes and opacities back to base
    for (const node of state.grid) {
      node.size += (node.targetSize - node.size) * 0.15;
      node.targetSize += (node.baseSize - node.targetSize) * 0.15;
      node.opacity += (node.baseOpacity - node.opacity) * 0.1;
    }

    // Sync special node positions for DOM overlays (labels, hit-testing, federation map)
    for (let si = 0; si < state.specials.length; si++) {
      const special = state.specials[si];
      const idx = special.gridI * state.gridCols + special.gridJ;
      const node = state.grid[idx];
      special.screenX = node.x;
      special.screenY = node.y;

      const labelEl = labelRefs.current[si];
      if (labelEl) {
        labelEl.style.left = `${node.x}px`;
        labelEl.style.top = `${node.y + 18}px`;
      }

      const navEl = navRefs.current[si];
      if (navEl) {
        navEl.style.left = `${node.x}px`;
        navEl.style.top = `${node.y}px`;
      }
    }

    if (focusIndexRef.current >= 0 && focusRef.current) {
      const focused = state.specials[focusIndexRef.current];
      const idx = focused.gridI * state.gridCols + focused.gridJ;
      const node = state.grid[idx];
      focusRef.current.style.left = `${node.x - 20}px`;
      focusRef.current.style.top = `${node.y - 20}px`;
    }

    if (state.federationMapMode !== state.lastFederationMode) {
      state.lastFederationMode = state.federationMapMode;
      updateFederationPaths(state);
    }

    // Update pulses
    updatePulses(dt);
    schedulePulses();

    // Throttle-update active conversations for panel
    if (timestamp - lastConversationUpdateRef.current > 500) {
      lastConversationUpdateRef.current = timestamp;
      setActiveConversations([...state.pulses]);
    }

    // Render
    gl.clear(gl.COLOR_BUFFER_BIT);
    renderNodes();
    renderEdges();
    renderPulseTrails();

    animFrameRef.current = requestAnimationFrame(animate);
  }, [updatePulses, schedulePulses, renderNodes, renderEdges, renderPulseTrails]);

  // ---- Event Handlers ----
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    stateRef.current.mouseX = x;
    stateRef.current.mouseY = y;

    // Check hover on special nodes
    const state = stateRef.current;
    let hovered: SpecialNodeRuntime | null = null;
    for (const special of state.specials) {
      const dx = x - special.screenX;
      const dy = y - special.screenY;
      if (Math.sqrt(dx * dx + dy * dy) < SPECIAL_NODE_HOVER_RADIUS) {
        hovered = special;
        break;
      }
    }
    setHoveredNode(hovered);

    if (hovered) {
      setTooltip({ x: e.clientX + 10, y: e.clientY - 30, text: `${hovered.org} (${hovered.software})` });
    } else {
      // Check pulse hover
      let pulseHovered = false;
      for (const pulse of state.pulses) {
        const pos = getLivePositionOnPath(state.grid, state.gridCols, pulse.gridPath, Math.min(pulse.progress, 1.0));
        const dx = x - pos.x;
        const dy = y - pos.y;
        if (Math.sqrt(dx * dx + dy * dy) < PULSE_HOVER_RADIUS) {
          const source = state.specials[pulse.fromIdx];
          const target = state.specials[pulse.toIdx];
          setTooltip({ x: e.clientX + 10, y: e.clientY - 30, text: `${source.org} -> ${target.org}: ${pulse.label}` });
          pulseHovered = true;
          break;
        }
      }
      if (!pulseHovered) {
        setTooltip(null);
      }
    }
  }, []);

  const handleMouseDown = useCallback(() => {
    stateRef.current.isPressed = true;
    const state = stateRef.current;
    if (state.longPressTimer) {
      clearTimeout(state.longPressTimer);
    }
    const timer = setTimeout(() => {
      const s = stateRef.current;
      if (s.federationMapMode === 'sticky') {
        s.federationMapMode = 'off';
      } else {
        s.federationMapMode = 'sticky';
      }
    }, LONG_PRESS_DELAY);
    state.longPressTimer = timer;
  }, []);

  const handleMouseUp = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const state = stateRef.current;
    state.isPressed = false;

    if (state.longPressTimer) {
      clearTimeout(state.longPressTimer);
      state.longPressTimer = null;

      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      let clickedSpecial: SpecialNodeRuntime | null = null;
      for (const special of state.specials) {
        const dx = x - special.screenX;
        const dy = y - special.screenY;
        if (Math.sqrt(dx * dx + dy * dy) < SPECIAL_NODE_CLICK_RADIUS) {
          clickedSpecial = special;
          break;
        }
      }

      if (clickedSpecial) {
        setSelectedNode(clickedSpecial);
      } else if (state.federationMapMode === 'off' || state.federationMapMode === 'sticky') {
        const maxDim = Math.max(state.width, state.height);
        state.rings.push(makeRing(x, y, maxDim));
        setSelectedNode(null);
        setFocusIndex(-1);
      }
    }
  }, []);

  const handleTouchStart = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
    const state = stateRef.current;
    state.isPressed = true;
    if (state.longPressTimer) {
      clearTimeout(state.longPressTimer);
    }
    const touch = e.touches[0];
    if (touch) {
      const canvas = canvasRef.current;
      if (canvas) {
        const rect = canvas.getBoundingClientRect();
        state.mouseX = touch.clientX - rect.left;
        state.mouseY = touch.clientY - rect.top;
      }
    }
    const timer = setTimeout(() => {
      const s = stateRef.current;
      if (s.federationMapMode === 'sticky') {
        s.federationMapMode = 'off';
      } else {
        s.federationMapMode = 'sticky';
      }
    }, LONG_PRESS_DELAY);
    state.longPressTimer = timer;
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
    const state = stateRef.current;
    const touch = e.touches[0];
    if (touch) {
      const canvas = canvasRef.current;
      if (canvas) {
        const rect = canvas.getBoundingClientRect();
        state.mouseX = touch.clientX - rect.left;
        state.mouseY = touch.clientY - rect.top;
      }
    }
    if (state.longPressTimer) {
      clearTimeout(state.longPressTimer);
      state.longPressTimer = null;
    }
  }, []);

  const handleTouchEnd = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
    const state = stateRef.current;
    state.isPressed = false;

    if (state.longPressTimer) {
      clearTimeout(state.longPressTimer);
      state.longPressTimer = null;

      const touch = e.changedTouches[0];
      if (!touch) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = touch.clientX - rect.left;
      const y = touch.clientY - rect.top;

      let clickedSpecial: SpecialNodeRuntime | null = null;
      for (const special of state.specials) {
        const dx = x - special.screenX;
        const dy = y - special.screenY;
        if (Math.sqrt(dx * dx + dy * dy) < SPECIAL_NODE_CLICK_RADIUS) {
          clickedSpecial = special;
          break;
        }
      }

      if (clickedSpecial) {
        setSelectedNode(clickedSpecial);
      } else if (state.federationMapMode === 'off' || state.federationMapMode === 'sticky') {
        const maxDim = Math.max(state.width, state.height);
        state.rings.push(makeRing(x, y, maxDim));
        setSelectedNode(null);
        setFocusIndex(-1);
      }
    }
  }, []);

  const handleTouchCancel = useCallback(() => {
    const state = stateRef.current;
    state.isPressed = false;
    if (state.longPressTimer) {
      clearTimeout(state.longPressTimer);
      state.longPressTimer = null;
    }
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const state = stateRef.current;
    const currentFocus = focusIndexRef.current;
    if (e.key === 'Escape') {
      setSelectedNode(null);
      setFocusIndex(-1);
      return;
    }

    if (e.key === 'Tab' && state.specials.length > 0) {
      const activeEl = document.activeElement;
      const canvasHasFocus = activeEl === canvasRef.current;
      const specialHasFocus = activeEl && activeEl.getAttribute('data-special-index') !== null;
      if (!canvasHasFocus && !specialHasFocus) return;

      e.preventDefault();
      const next = e.shiftKey
        ? (currentFocus - 1 + state.specials.length) % state.specials.length
        : (currentFocus + 1) % state.specials.length;
      setFocusIndex(next);
    }

    if (e.key === 'Enter' && currentFocus >= 0 && currentFocus < state.specials.length) {
      setSelectedNode(state.specials[currentFocus]);
    }
  }, []);

  // ---- Effects ----
  useEffect(() => {
    const initialized = initWebGL();
    if (!initialized) return;

    const container = containerRef.current;
    if (container) {
      const rect = container.getBoundingClientRect();
      buildGrid(rect.width, rect.height);
    }

    resize();
    loadLogoTexture();

    animFrameRef.current = requestAnimationFrame(animate);

    const handleResize = () => resize();
    window.addEventListener('resize', handleResize);

    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handleMotionChange = (e: MediaQueryListEvent) => {
      stateRef.current.reducedMotion = e.matches;
    };
    motionQuery.addEventListener('change', handleMotionChange);

    return () => {
      isMountedRef.current = false;
      cancelAnimationFrame(animFrameRef.current);
      window.removeEventListener('resize', handleResize);
      motionQuery.removeEventListener('change', handleMotionChange);

      const state = stateRef.current;
      if (state.longPressTimer) {
        clearTimeout(state.longPressTimer);
      }

      const gl = state.gl;
      if (gl) {
        if (state.posBuffer) gl.deleteBuffer(state.posBuffer);
        if (state.sizeBuffer) gl.deleteBuffer(state.sizeBuffer);
        if (state.opacityBuffer) gl.deleteBuffer(state.opacityBuffer);
        if (state.typeBuffer) gl.deleteBuffer(state.typeBuffer);
        if (state.fedColorBuffer) gl.deleteBuffer(state.fedColorBuffer);
        if (state.hasFedColorBuffer) gl.deleteBuffer(state.hasFedColorBuffer);
        if (state.logoTexture) gl.deleteTexture(state.logoTexture);
        if (state.program) gl.deleteProgram(state.program);
      }
    };
  }, [initWebGL, resize, loadLogoTexture]);

  // ---- Render ----
  const state = stateRef.current;
  const selectedNodeIdx = selectedNode ? state.specials.findIndex(s => s.id === selectedNode.id) : -1;
  const talkingTo = selectedNodeIdx >= 0
    ? activeConversations.filter(p => p.fromIdx === selectedNodeIdx || p.toIdx === selectedNodeIdx)
    : [];

  const rejectionHistory = selectedNode
    ? (state.rejectionHistory.get(selectedNode.id) || [])
    : [];

  const capabilityPill = (cap: string) => {
    const colorClass = CAPABILITY_COLORS[cap] || 'bg-gray-100 text-gray-800';
    return (
      <span key={cap} className={`text-xs px-2 py-0.5 rounded-full ${colorClass}`}>
        {cap}
      </span>
    );
  };

  return (
    <div ref={containerRef} className="relative w-full h-full overflow-hidden">
      {/* WebGL canvas for nodes */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
        style={{ touchAction: 'none' }}
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchCancel}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        aria-label="Interactive OCM protocol simulation showing real-time interoperability between research organizations"
        role="img"
      />

      {/* Canvas2D overlay for pulse trails */}
      <canvas
        ref={pulseCanvasRef}
        className="absolute inset-0 w-full h-full pointer-events-none"
      />

      {/* HTML labels for special nodes */}
      {state.specials.map((special, idx) => (
        <div
          ref={el => { labelRefs.current[idx] = el; }}
          key={special.id}
          className="absolute pointer-events-none text-xs font-medium text-white/80 select-none"
          style={{
            left: special.screenX,
            top: special.screenY + 18,
            transform: 'translateX(-50%)',
            textShadow: '0 1px 3px rgba(0,0,0,0.5)',
            opacity: 0.8,
          }}
        >
          {special.org}
        </div>
      ))}

      {/* Keyboard focus indicator */}
      {focusIndex >= 0 && focusIndex < state.specials.length && (
        <div
          ref={focusRef}
          className="absolute pointer-events-none rounded-full border-2 border-white/80"
          style={{
            left: state.specials[focusIndex].screenX - 20,
            top: state.specials[focusIndex].screenY - 20,
            width: 40,
            height: 40,
            boxShadow: '0 0 0 2px rgba(59,130,246,0.5), 0 0 12px rgba(59,130,246,0.3)',
          }}
        />
      )}

      {/* Hover tooltip */}
      {tooltip && (
        <div
          className="fixed pointer-events-none bg-black/80 text-white text-xs px-3 py-2 rounded-lg z-30"
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          {tooltip.text}
        </div>
      )}

      {/* Detail panel */}
      {selectedNode && (
        <div
          className={`absolute bg-white/95 backdrop-blur-sm rounded-xl shadow-2xl p-5 z-40
            ${state.isMobile
              ? 'bottom-0 left-0 right-0 rounded-b-none max-h-[60vh] overflow-y-auto'
              : 'right-4 top-4 w-72'
            }`}
        >
          <button
            className="absolute top-2 right-2 text-gray-400 hover:text-gray-600 text-lg leading-none"
            onClick={() => { setSelectedNode(null); setFocusIndex(-1); }}
            aria-label="Close detail panel"
          >
            &times;
          </button>

          <h3 className="text-lg font-bold text-gray-900">{selectedNode.org}</h3>
          <p className="text-sm text-gray-600 mt-1">{selectedNode.software}</p>
          <p className="text-xs text-gray-500 mt-1 font-mono">{selectedNode.fqdn}</p>

          {selectedNode.instanceUrl && (
            <a
              href={selectedNode.instanceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-600 hover:text-blue-800 mt-1 block"
            >
              {selectedNode.instanceUrl}
            </a>
          )}

          <div className="mt-4">
            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Capabilities</h4>
            <div className="flex flex-wrap gap-1 mt-2">
              {selectedNode.capabilities.map(cap => capabilityPill(cap))}
            </div>
          </div>

          {talkingTo.length > 0 && (
            <div className="mt-4">
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Active Conversations</h4>
              <div className="mt-2 space-y-1">
                {talkingTo.map((pulse, i) => {
                  const otherIdx = pulse.fromIdx === selectedNodeIdx ? pulse.toIdx : pulse.fromIdx;
                  const other = state.specials[otherIdx];
                  const isOutgoing = pulse.fromIdx === selectedNodeIdx;
                  const stepLabel = pulse.isRejection
                    ? `R${pulse.stepIndex + 1}`
                    : `S${pulse.stepIndex + 1}`;
                  return (
                    <div key={i} className="text-xs text-gray-700 flex items-center gap-2">
                      <span
                        className="w-2 h-2 rounded-full inline-block"
                        style={{ backgroundColor: `rgb(${pulse.color.join(',')})` }}
                      />
                      <span className="font-mono text-gray-400">{stepLabel}</span>
                      <span>{isOutgoing ? '→' : '←'}</span>
                      <span>{other?.org}: {pulse.label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {rejectionHistory.length > 0 && (
            <div className="mt-4">
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Rejection History</h4>
              <div className="mt-2 space-y-1">
                {rejectionHistory.slice().reverse().map((rec, i) => {
                  const fromConfig = configs.find(c => c.id === rec.from);
                  return (
                    <div key={i} className="text-xs text-red-600">
                      403: {fromConfig?.org || rec.from} rejected
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {selectedNode.exclusive && (
            <div className="mt-4">
              <span className="text-xs bg-red-100 text-red-800 px-2 py-0.5 rounded-full">
                Exclusive mode - only accepts from preferred neighbors
              </span>
            </div>
          )}
        </div>
      )}

      {/* Keyboard navigation buttons */}
      <div className="sr-only" role="list">
        {state.specials.map((special, idx) => (
          <button
            ref={el => { navRefs.current[idx] = el; }}
            key={special.id}
            role="listitem"
            tabIndex={0}
            aria-label={`${special.org} (${special.software})`}
            onFocus={() => setFocusIndex(idx)}
            onClick={() => setSelectedNode(special)}
            style={{
              position: 'absolute',
              left: special.screenX,
              top: special.screenY,
              width: 1,
              height: 1,
              opacity: 0,
            }}
          />
        ))}
      </div>

      {/* Accessibility live region */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {liveText}
      </div>
    </div>
  );
}
