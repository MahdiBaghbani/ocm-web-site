export interface GridCoord {
  i: number;
  j: number;
}

export interface TrailPoint {
  segIdx: number;
  frac: number;
}

export interface WaypointResult {
  waypoints: GridCoord[];
  gridPath: GridCoord[];
}

/**
 * Maximum reconfiguration attempts per phase in selectWaypointsWithConstraints.
 * Chosen empirically: on a 10×10 grid with k≤5 and dMin≥2, >95% of paths
 * succeed within 100 attempts; increasing to 200 yields <0.5% extra wins.
 */
export const MAX_PATH_ATTEMPTS = 100;

export function chebyshevDistance(a: GridCoord, b: GridCoord): number {
  return Math.max(Math.abs(a.i - b.i), Math.abs(a.j - b.j));
}

export function findPath(start: GridCoord, end: GridCoord): GridCoord[] {
  const path: GridCoord[] = [];
  let ci = start.i;
  let cj = start.j;

  while (ci !== end.i || cj !== end.j) {
    path.push({ i: ci, j: cj });
    const di = Math.sign(end.i - ci);
    const dj = Math.sign(end.j - cj);
    if (di !== 0 && dj !== 0) {
      ci += di;
      cj += dj;
    } else if (di !== 0) {
      ci += di;
    } else {
      cj += dj;
    }
  }
  path.push({ i: ci, j: cj });
  return path;
}

export function constructPath(
  start: GridCoord,
  end: GridCoord,
  waypoints: GridCoord[],
  grid: { specialIndex: number }[],
  cols: number,
  checkSpecialNodes: boolean
): GridCoord[] | null {
  if (cols <= 0 || !Number.isFinite(cols)) return null;

  const path: GridCoord[] = [start];
  const seen = new Set<string>([`${start.i},${start.j}`]);

  for (let k = 0; k <= waypoints.length; k++) {
    const from = k > 0 ? waypoints[k - 1] : start;
    const to = k < waypoints.length ? waypoints[k] : end;
    const segment = findPath(from, to);

    for (let i = 1; i < segment.length; i++) {
      const v = segment[i];
      const key = `${v.i},${v.j}`;
      const idx = v.i * cols + v.j;

      if (seen.has(key)) {
        return null;
      }
      seen.add(key);

      if (checkSpecialNodes && !(v.i === end.i && v.j === end.j)) {
        if (grid[idx]?.specialIndex !== -1) {
          return null;
        }
      }

      path.push(v);
    }
  }

  return path;
}

export function trySelectWaypoints(
  start: GridCoord,
  end: GridCoord,
  k: number,
  dMin: number,
  rows: number,
  cols: number
): GridCoord[] {
  const waypoints: GridCoord[] = [];
  const minI = Math.min(start.i, end.i);
  const maxI = Math.max(start.i, end.i);
  const minJ = Math.min(start.j, end.j);
  const maxJ = Math.max(start.j, end.j);

  const boxWidth = maxI - minI;
  const boxHeight = maxJ - minJ;
  if (boxWidth < dMin && boxHeight < dMin) {
    return waypoints;
  }

  const maxICapped = rows - 1;
  const maxJCapped = cols - 1;

  for (let attempt = 0; attempt < k * 20 && waypoints.length < k; attempt++) {
    let ci = minI + Math.floor(Math.random() * (maxI - minI + 1));
    let cj = minJ + Math.floor(Math.random() * (maxJ - minJ + 1));
    ci = Math.max(0, Math.min(maxICapped, ci));
    cj = Math.max(0, Math.min(maxJCapped, cj));

    const w = { i: ci, j: cj };
    if (chebyshevDistance(w, start) >= dMin &&
        chebyshevDistance(w, end) >= dMin &&
        waypoints.every(wp => chebyshevDistance(w, wp) >= dMin)) {
      waypoints.push(w);
    }
  }

  return waypoints;
}

/**
 * selectWaypointsWithConstraints — 4-phase path construction with fallbacks.
 *
 * Phase 1: Generate up to MAX_PATH_ATTEMPTS waypoint sets with full constraints
 *   (simple path + special-node avoidance). Returns immediately on success.
 *
 * Phase 2: If Phase 1 failed, retry the last attempted waypoints without
 *   special-node checking. Reuses waypoints to avoid losing progress.
 *
 * Phase 3: Fresh random waypoint generation without special-node checking.
 *   Explores paths Phase 1 could not reach.
 *
 * Phase 4: Direct straight-line path from start to end. Always succeeds.
 */
export function selectWaypointsWithConstraints(
  start: GridCoord,
  end: GridCoord,
  minWp: number,
  maxWp: number,
  dMin: number,
  rows: number,
  cols: number,
  grid: { specialIndex: number }[]
): WaypointResult {
  if (minWp > maxWp) {
    throw new Error(
      `selectWaypointsWithConstraints: minWp (${minWp}) must not exceed maxWp (${maxWp})`
    );
  }

  const desiredK = minWp + Math.floor(Math.random() * (maxWp - minWp + 1));
  let lastWaypoints: GridCoord[] = [];

  for (let attempt = 0; attempt < MAX_PATH_ATTEMPTS; attempt++) {
    const waypoints = trySelectWaypoints(start, end, desiredK, dMin, rows, cols);
    const path = constructPath(start, end, waypoints, grid, cols, true);
    if (path !== null) {
      return { waypoints, gridPath: path };
    }
    lastWaypoints = waypoints;
  }

  if (lastWaypoints.length > 0) {
    const path = constructPath(start, end, lastWaypoints, grid, cols, false);
    if (path !== null) {
      return { waypoints: lastWaypoints, gridPath: path };
    }
  }

  for (let attempt = 0; attempt < MAX_PATH_ATTEMPTS; attempt++) {
    const waypoints = trySelectWaypoints(start, end, desiredK, dMin, rows, cols);
    const path = constructPath(start, end, waypoints, grid, cols, false);
    if (path !== null) {
      return { waypoints, gridPath: path };
    }
  }

  const directPath = findPath(start, end);
  return { waypoints: [], gridPath: directPath };
}

export function getLivePositionOnPath(
  grid: { x: number; y: number }[],
  cols: number,
  gridPath: GridCoord[],
  progress: number
): { x: number; y: number } {
  if (gridPath.length === 0) return { x: 0, y: 0 };
  if (gridPath.length === 1) {
    const node = grid[gridPath[0].i * cols + gridPath[0].j];
    return { x: node.x, y: node.y };
  }

  const totalSegments = gridPath.length - 1;
  const clamped = Math.min(Math.max(progress, 0), 1);
  const exactIdx = clamped * totalSegments;
  const idx = Math.min(Math.floor(exactIdx), totalSegments - 1);
  const frac = exactIdx - idx;

  const from = grid[gridPath[idx].i * cols + gridPath[idx].j];
  const to   = grid[gridPath[idx + 1].i * cols + gridPath[idx + 1].j];

  return {
    x: from.x + (to.x - from.x) * frac,
    y: from.y + (to.y - from.y) * frac,
  };
}

export function resolveTrailPoint(
  pt: TrailPoint,
  gridPath: GridCoord[],
  grid: { x: number; y: number }[],
  cols: number
): { x: number; y: number } {
  if (!gridPath || gridPath.length < 2) return { x: 0, y: 0 };
  const segIdx = pt.segIdx;
  if (segIdx < 0 || segIdx >= gridPath.length - 1) return { x: 0, y: 0 };
  if (!Number.isFinite(pt.frac)) return { x: 0, y: 0 };

  const clampedFrac = Math.min(Math.max(pt.frac, 0), 1);
  const from = grid[gridPath[segIdx].i * cols + gridPath[segIdx].j];
  const to   = grid[gridPath[segIdx + 1].i * cols + gridPath[segIdx + 1].j];
  return {
    x: from.x + (to.x - from.x) * clampedFrac,
    y: from.y + (to.y - from.y) * clampedFrac,
  };
}

// ---------------------------------------------------------------------------
// Federation Map — Mesh-Constrained Edge Routing
// ---------------------------------------------------------------------------

export interface Point {
  x: number;
  y: number;
}

/**
 * Return the 8-neighbor grid cells of (i, j) that lie within [0, rows) × [0, cols).
 */
export function getNeighbors(i: number, j: number, rows: number, cols: number): GridCoord[] {
  const neighbors: GridCoord[] = [];
  for (let di = -1; di <= 1; di++) {
    for (let dj = -1; dj <= 1; dj++) {
      if (di === 0 && dj === 0) continue;
      const ni = i + di;
      const nj = j + dj;
      if (ni >= 0 && ni < rows && nj >= 0 && nj < cols) {
        neighbors.push({ i: ni, j: nj });
      }
    }
  }
  return neighbors;
}

/**
 * Find a mesh path between two grid coordinates using diagonal-first shortest path.
 * This is the same algorithm used for pulse routing, ensuring federation edges
 * follow the grid topology.
 */
export function findMeshPath(
  start: GridCoord,
  end: GridCoord
): GridCoord[] {
  return findPath(start, end);
}

/**
 * Validate that a mesh path does not pass through intermediate special nodes.
 * Endpoints are allowed (they are the source and destination).
 */
export function isValidMeshPath(
  path: GridCoord[],
  grid: { specialIndex: number }[],
  cols: number
): boolean {
  if (cols <= 0) return false;
  for (let k = 1; k < path.length - 1; k++) {
    const idx = path[k].i * cols + path[k].j;
    if (idx < 0 || idx >= grid.length || grid[idx]?.specialIndex !== -1) return false;
  }
  return true;
}

/**
 * Resolve a grid path to live node positions for rendering.
 * Federation edges call this each frame to follow node displacements.
 */
export function resolveEdgePoints(
  path: GridCoord[],
  grid: { x: number; y: number }[],
  cols: number
): Point[] {
  if (cols <= 0) return [];
  return path.map(c => {
    const idx = c.i * cols + c.j;
    if (idx < 0 || idx >= grid.length) return { x: 0, y: 0 };
    const node = grid[idx];
    return { x: node.x, y: node.y };
  });
}

/**
 * Apply perpendicular lane offset to edge points for circuit-board aesthetic.
 * Parallel edges fan out slightly based on their edge index.
 */
export function applyLaneOffset(points: Point[], edgeIndex: number, totalEdges: number, delta: number = 1.5): Point[] {
  const offset = (edgeIndex - (totalEdges - 1) / 2) * delta;
  return points.map((p, i) => {
    if (i === 0 || i === points.length - 1) return p;
    const prev = points[i - 1];
    const next = points[i + 1];
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) return p;
    const perpX = (-dy / len) * offset;
    const perpY = (dx / len) * offset;
    return { x: p.x + perpX, y: p.y + perpY };
  });
}
