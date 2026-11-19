// The dice bodies: convex polyhedra as vertices and faces, and the geometry the numbers need.
// Units are mm; y is up, z towards the front. Faces list their corners counter-clockwise seen from outside.

export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const length = (a) => Math.hypot(a[0], a[1], a[2]);
export const unit = (a) => mul(a, 1 / (length(a) || 1));
const average = (points) => mul(points.reduce(add, [0, 0, 0]), 1 / points.length);

const PHI = (1 + Math.sqrt(5)) / 2;
const signs = (...values) => values.reduce((all, value) => all.flatMap((list) => (value === 0 ? [[...list, 0]] : [[...list, value], [...list, -value]])), [[]]);

const CUBE = signs(1, 1, 1);
const AXES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const TETRA = [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]];
const ICOSA = [...signs(0, 1, PHI), ...signs(1, PHI, 0).map(([a, b]) => [a, b, 0]), ...signs(PHI, 0, 1).map(([a, , c]) => [a, 0, c])];
// The dodecahedron dual to ICOSA: its corners lie over the middles of ICOSA's faces (and the other way round).
const DODECA = [...CUBE, ...signs(0, PHI, 1 / PHI), ...signs(1 / PHI, 0, PHI).map(([a, , c]) => [a, 0, c]), ...signs(PHI, 1 / PHI, 0).map(([a, b]) => [a, b, 0])];

/** Sorts a face's corners counter-clockwise round its outward normal. */
function ordered(vertices, indices, normal) {
  const centre = average(indices.map((index) => vertices[index]));
  const across = unit(sub(vertices[indices[0]], centre));
  const along = cross(normal, across);
  const angle = (index) => {
    const offset = sub(vertices[index], centre);
    return Math.atan2(dot(offset, along), dot(offset, across));
  };
  return [...indices].sort((a, b) => angle(a) - angle(b));
}

/** The faces of a convex solid, given which way each face points: the corners furthest out that way. */
function facesFromNormals(vertices, normals) {
  return normals.map((direction) => {
    const normal = unit(direction);
    const reach = Math.max(...vertices.map((vertex) => dot(vertex, normal)));
    const indices = vertices.map((vertex, index) => (dot(vertex, normal) > reach - 1e-6 ? index : -1)).filter((index) => index >= 0);
    return ordered(vertices, indices, normal);
  });
}

/** A pentagonal trapezohedron (D10): two apexes, two rings of five, kite faces. */
function trapezohedron() {
  const ring = 0.11;
  const point = (degrees, y) => [Math.cos((degrees * Math.PI) / 180), y, Math.sin((degrees * Math.PI) / 180)];
  // The apex height that makes each kite flat: its fourth corner on the plane of the other three.
  const offPlane = (apex) => {
    const top = [0, apex, 0];
    const normal = cross(sub(point(0, ring), top), sub(point(72, ring), top));
    return dot(sub(point(36, -ring), top), normal);
  };
  let low = ring * 1.01;
  let high = 50;
  for (let step = 0; step < 200; step += 1) {
    const middle = (low + high) / 2;
    if (Math.sign(offPlane(middle)) === Math.sign(offPlane(low))) low = middle;
    else high = middle;
  }
  const apex = (low + high) / 2;
  const vertices = [[0, apex, 0], [0, -apex, 0]];
  for (let k = 0; k < 5; k += 1) vertices.push(point(72 * k, ring));
  for (let k = 0; k < 5; k += 1) vertices.push(point(72 * k + 36, -ring));
  const upper = (k) => 2 + (k % 5);
  const lower = (k) => 7 + (k % 5);
  const faces = [];
  for (let k = 0; k < 5; k += 1) faces.push([0, upper(k), lower(k), upper(k + 1)]);
  for (let k = 0; k < 5; k += 1) faces.push([1, lower(k + 1), upper(k + 1), lower(k)]);
  return {
    vertices,
    faces: faces.map((face) => {
      const centre = average(face.map((index) => vertices[index]));
      return ordered(vertices, face, unit(centre));
    }),
  };
}

/** The solid for a die, before it is sized and turned. */
export function baseSolid(sides) {
  switch (sides) {
    case 3:
    case 6: return { vertices: CUBE, faces: facesFromNormals(CUBE, AXES) };
    case 4: return { vertices: TETRA, faces: facesFromNormals(TETRA, TETRA.map((vertex) => mul(vertex, -1))) };
    case 8: return { vertices: AXES, faces: facesFromNormals(AXES, CUBE) };
    case 10: return trapezohedron();
    case 12: return { vertices: DODECA, faces: facesFromNormals(DODECA, ICOSA) };
    case 20: return { vertices: ICOSA, faces: facesFromNormals(ICOSA, DODECA) };
    default: throw new Error(`No D${sides}`);
  }
}

export function faceNormal(vertices, face) {
  let normal = [0, 0, 0];
  for (let index = 0; index < face.length; index += 1) {
    const a = vertices[face[index]];
    const b = vertices[face[(index + 1) % face.length]];
    normal = add(normal, [(a[1] - b[1]) * (a[2] + b[2]), (a[2] - b[2]) * (a[0] + b[0]), (a[0] - b[0]) * (a[1] + b[1])]);
  }
  return unit(normal);
}

/** The rotation that turns direction `from` onto direction `to`, as a function on points. */
export function rotationBetween(from, to) {
  const a = unit(from);
  const b = unit(to);
  const axis = cross(a, b);
  const sin = length(axis);
  const cos = dot(a, b);
  if (sin < 1e-9) {
    if (cos > 0) return (point) => point;
    // Half a turn about any axis square to `from`.
    const other = Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 0, 1];
    const k = unit(cross(a, other));
    return (point) => sub(mul(k, 2 * dot(k, point)), point);
  }
  const k = mul(axis, 1 / sin);
  return (point) => add(add(mul(point, cos), mul(cross(k, point), sin)), mul(k, dot(k, point) * (1 - cos)));
}

/** The faces' outline as a closed triangle mesh for layerling. */
export function meshOf(vertices, faces) {
  const positions = [];
  for (const face of faces) {
    for (let index = 1; index + 1 < face.length; index += 1) {
      positions.push(...vertices[face[0]], ...vertices[face[index]], ...vertices[face[index + 1]]);
    }
  }
  return { positions };
}

/**
 * The biggest circle inside a face: where a number fits best. Found by searching the face, which works for every
 * convex face shape here (triangles, squares, pentagons, kites).
 */
export function inCircle(vertices, face, normal) {
  const corners = face.map((index) => vertices[index]);
  const origin = average(corners);
  const across = unit(sub(corners[0], origin));
  const along = cross(normal, across);
  const flat = corners.map((corner) => [dot(sub(corner, origin), across), dot(sub(corner, origin), along)]);
  const edges = flat.map((a, index) => {
    const b = flat[(index + 1) % flat.length];
    const direction = [b[0] - a[0], b[1] - a[1]];
    const size = Math.hypot(direction[0], direction[1]);
    // Inward normal of a counter-clockwise outline.
    return { a, inward: [-direction[1] / size, direction[0] / size] };
  });
  const clearance = (x, y) => Math.min(...edges.map(({ a, inward }) => (x - a[0]) * inward[0] + (y - a[1]) * inward[1]));
  let best = { x: 0, y: 0, r: clearance(0, 0) };
  let span = Math.max(...flat.map(([x, y]) => Math.hypot(x, y)));
  for (let round = 0; round < 8; round += 1) {
    const centre = best;
    for (let i = -6; i <= 6; i += 1) {
      for (let j = -6; j <= 6; j += 1) {
        const x = centre.x + (i / 6) * span;
        const y = centre.y + (j / 6) * span;
        const r = clearance(x, y);
        if (r > best.r) best = { x, y, r };
      }
    }
    span /= 3;
  }
  return { centre: add(origin, add(mul(across, best.x), mul(along, best.y))), radius: best.r };
}

/** Faces sharing an edge, by face index. */
export function neighbours(faces) {
  return faces.map((face, index) => faces.map((other, otherIndex) => {
    if (otherIndex === index) return -1;
    const shared = face.filter((corner) => other.includes(corner)).length;
    return shared >= 2 ? otherIndex : -1;
  }).filter((otherIndex) => otherIndex >= 0));
}

/** The faces round each corner, by corner index. */
export function cornerFaces(vertexCount, faces) {
  const around = Array.from({ length: vertexCount }, () => []);
  faces.forEach((face, faceIndex) => face.forEach((corner) => around[corner].push(faceIndex)));
  return around.filter((list) => list.length > 0);
}

/**
 * A path through every face, each next to the one before (for spin-down numbering). With `cycle`, the last face is
 * next to the first as well, so 1 sits beside 20.
 */
export function facePath(faces, start = 0, { cycle = false } = {}) {
  const next = neighbours(faces);
  const path = [start];
  const seen = new Set(path);
  let steps = 0;
  const walk = () => {
    if (path.length === faces.length) return !cycle || next[path[path.length - 1]].includes(path[0]);
    if ((steps += 1) > 200000) return false;
    const here = path[path.length - 1];
    // Fewest ways on first (Warnsdorff): finds a path at once on these solids.
    const options = next[here].filter((face) => !seen.has(face))
      .sort((a, b) => next[a].filter((face) => !seen.has(face)).length - next[b].filter((face) => !seen.has(face)).length);
    for (const face of options) {
      path.push(face);
      seen.add(face);
      if (walk()) return true;
      path.pop();
      seen.delete(face);
    }
    return false;
  };
  if (!walk()) throw new Error("No path through the faces");
  return path;
}

/**
 * The classic spin-down order: 1 on the bottom face, the highest on the top face, and the numbers climbing the die
 * between them in a spiral, each next to the one before. Of all such paths it takes the one that steps down the
 * least (counted over every pair of faces taken out of height order), then the one that keeps turning the same way.
 */
export function climbingPath(vertices, faces) {
  const next = neighbours(faces);
  const normals = faces.map((face) => faceNormal(vertices, face));
  const centres = faces.map((face) => mul(face.reduce((sum, index) => add(sum, vertices[index]), [0, 0, 0]), 1 / face.length));
  const bottom = 0;
  const top = opposites(vertices, faces)[bottom];
  const up = mul(normals[bottom], -1);
  const height = centres.map((centre) => dot(centre, up));
  const across = unit(cross(up, Math.abs(up[0]) < 0.9 ? [1, 0, 0] : [0, 0, 1]));
  const along = cross(up, across);
  const angle = centres.map((centre) => Math.atan2(dot(centre, along), dot(centre, across)));
  const flat = (face) => Math.abs(dot(centres[face], across)) + Math.abs(dot(centres[face], along)) < 1e-6;
  const eps = 1e-6;

  let best = null;
  let steps = 0;
  const path = [bottom];
  const seen = new Set(path);
  const walk = (stepDowns, turnsBack) => {
    if ((steps += 1) > 2000000) return;
    const cost = stepDowns * 1000 + turnsBack;
    if (best && cost >= best.cost) return;
    const here = path[path.length - 1];
    if (path.length === faces.length) {
      best = { cost, path: [...path] };
      return;
    }
    for (const face of next[here]) {
      if (seen.has(face)) continue;
      // The top face comes last.
      if (face === top && path.length !== faces.length - 1) continue;
      let down = 0;
      for (const earlier of path) if (height[earlier] > height[face] + eps) down += 1;
      // Turning back: round the die against the spiral, which climbs clockwise seen from above, as on the
      // classic MTG spin-down (checked against one).
      let back = 0;
      if (!flat(here) && !flat(face)) {
        const turn = Math.atan2(Math.sin(angle[face] - angle[here]), Math.cos(angle[face] - angle[here]));
        if (turn > eps) back = 1;
      }
      path.push(face);
      seen.add(face);
      walk(stepDowns + down, turnsBack + back);
      path.pop();
      seen.delete(face);
    }
  };
  walk(0, 0);
  if (!best) throw new Error("No spin-down path");
  return best.path;
}

/** The face pointing the other way, for every face (dice whose opposite faces are parallel). */
export function opposites(vertices, faces) {
  const normals = faces.map((face) => faceNormal(vertices, face));
  return normals.map((normal) => {
    let best = -1;
    let bestDot = 2;
    normals.forEach((other, index) => {
      const d = dot(normal, other);
      if (d < bestDot) {
        bestDot = d;
        best = index;
      }
    });
    return best;
  });
}