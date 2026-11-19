// Dice for layerling: D3, D4, D6, D8, D10, D12, D20.
// The body is a mesh made here (solids.js); the numbers are layerling's own text, turned onto each face.
import {
  add, baseSolid, climbingPath, cornerFaces, cross, dot, faceNormal, facePath, inCircle, length, meshOf, mul, opposites, rotationBetween, sub, unit,
} from "./solids.js";

const ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" fill="none" stroke="#c3731f" stroke-width="2.4" stroke-linejoin="round"><path d="M24 4 41 14v20L24 44 7 34V14z"/><path d="M24 4 15 21h18zM15 21 7 34M33 21l8 13M15 21l9 23 9-23M7 14l8 7M41 14l-8 7"/><text x="24" y="34" font-family="sans-serif" font-size="9" font-weight="700" fill="#c3731f" stroke="none" text-anchor="middle">20</text></svg>`;

const SIDES = [3, 4, 6, 8, 10, 12, 20];
const FONTS = ["Sans", "Rounded", "Serif", "Monospace", "Stencil", "Multilanguage"];

export default function activate(layerling) {
  layerling.registerShape({
    id: "dice",
    name: "Dice",
    icon: ICON,
    keywords: ["die", "d20", "d6", "dnd", "mtg", "spindown", "spin down", "rpg"],
    options: [
      { key: "sides", label: "Sides", type: "select", default: "20", options: SIDES.map((n) => ({ value: String(n), label: `D${n}` })) },
      { key: "order", label: "Numbering", type: "select", default: "roll", options: [
        { value: "roll", label: "Roll (D&D)" },
        { value: "spin", label: "Spin-down (MTG)" },
      ], help: "Roll: opposite faces add up to the same total. Spin-down: each number sits next to the one before, for counting life." },
      { key: "values", label: "Numbers", type: "select", default: "ones", options: [
        { value: "ones", label: "1, 2, 3 …" },
        { value: "tens", label: "10, 20, 30 …" },
      ] },
      { key: "zero", label: "Start at 0 (D10)", type: "boolean", default: false, help: "D10 only: 0-9, or 00-90 with tens" },
      { key: "loop", label: "1 next to 20 (spin-down)", type: "boolean", default: false, help: "Spin-down only: instead of 1 at the bottom, the numbers snake round so 1 sits beside the highest and a new game is one turn away" },
      { key: "style", label: "Number style", type: "select", default: "embedded", options: [
        { value: "embedded", label: "Embedded (flush, own colour)" },
        { value: "recessed", label: "Recessed" },
        { value: "raised", label: "Raised" },
      ] },
      { key: "size", label: "Size", type: "number", default: 20, min: 8, max: 120, step: 0.5, unit: "mm", help: "Height as it sits on the plate" },
      { key: "depth", label: "Number depth", type: "number", default: 0.8, min: 0.2, max: 4, step: 0.1, unit: "mm", help: "How deep embedded and recessed numbers go, or how far raised ones stand out" },
      { key: "numberSize", label: "Number size", type: "number", default: 100, min: 40, max: 160, step: 5, unit: "%" },
      { key: "font", label: "Font", type: "select", default: "Sans", options: FONTS.map((font) => ({ value: font, label: font })) },
      { key: "mark", label: "Dot after 6 and 9", type: "boolean", default: true, help: "Only where a number would read as another upside down" },
      { key: "diceColor", label: "Dice colour", type: "color", default: "#1f4e8c" },
      { key: "numberColor", label: "Number colour", type: "color", default: "#f2f2f2" },
    ],
    build: (values) => {
      // An older host turns mesh and group parts into plain boxes: say so instead.
      if (!(layerling.apiVersion >= 2)) throw new Error("needs a newer layerling-extensions (mesh and group parts). Update it, then add the dice again.");
      return buildDice(values);
    },
  });
}

// ---- Numbering ------------------------------------------------------------------------------------------------------

/** A random number source that gives the same numbers every time, so a die rebuilds with the same layout. */
function seeded(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The value on each face (D4: on each corner), 1-based, before any 0 start or tens.
 *
 * Roll (the usual rules for gaming dice): opposite faces add up to sides + 1; the numbers are spread so the faces
 * round every corner add up to totals as close as possible (no corner of all high or all low numbers); on a D6, 1-2-3
 * run counter-clockwise round their corner; on a D10 the odd numbers ring one tip and the even ones the other.
 *
 * Spin-down: each number shares an edge with the next, so the die turns from the highest down to 1. Classic: 1 on the
 * bottom face, the highest on top, the numbers climbing the die in a spiral between them. With `loop`, they snake
 * round instead so 1 sits beside the highest. Opposite faces can't also add up to sides + 1 on a spin-down: the two middle numbers
 * (10 and 11 on a D20) would have to be opposite and side by side at once.
 */
function numberFaces(sides, solid, order, loop) {
  const { vertices, faces } = solid;
  if (sides === 4) return vertices.map((_, index) => index + 1);
  if (sides === 3) {
    // A D3 is a D6 numbered 1-3 twice: 1,2 → 1; 3,4 → 2; 5,6 → 3.
    return numberFaces(6, solid, order, loop).map((value) => Math.ceil(value / 2));
  }
  const n = faces.length;
  const values = new Array(n).fill(0);
  if (order === "spin") {
    (loop ? facePath(faces, 0, { cycle: true }) : climbingPath(vertices, faces)).forEach((face, index) => (values[face] = index + 1));
    return values;
  }

  const opposite = opposites(vertices, faces);
  const pairs = [];
  faces.forEach((_, face) => {
    if (face < opposite[face]) pairs.push([face, opposite[face]]);
  });
  const corners = cornerFaces(vertices.length, faces);
  // A D10's kites round the top tip (corner 0) take the odd numbers.
  const oddFace = (face) => sides === 10 && faces[face].includes(0);

  const assign = (order, flips) => {
    pairs.forEach(([a, b], index) => {
      const low = order[index] + 1;
      let [lowFace, highFace] = flips[index] ? [b, a] : [a, b];
      if (sides === 10 && oddFace(low % 2 === 1 ? highFace : lowFace)) [lowFace, highFace] = [highFace, lowFace];
      values[lowFace] = low;
      values[highFace] = n + 1 - low;
    });
  };
  const spread = () => {
    const sums = corners.map((around) => around.reduce((sum, face) => sum + values[face], 0));
    const mean = sums.reduce((a, b) => a + b, 0) / sums.length;
    return sums.reduce((sum, total) => sum + (total - mean) ** 2, 0);
  };

  // Search for the most even spread: swap pairs and turn them over while it gets better, from several starts.
  const random = seeded(sides * 7919);
  let best = null;
  for (let start = 0; start < 40; start += 1) {
    const order = pairs.map((_, index) => index).sort(() => random() - 0.5);
    const flips = pairs.map(() => random() < 0.5);
    assign(order, flips);
    let score = spread();
    for (let step = 0; step < 4000; step += 1) {
      const i = Math.floor(random() * pairs.length);
      const j = Math.floor(random() * pairs.length);
      const flip = random() < 0.4;
      if (flip) flips[i] = !flips[i];
      else [order[i], order[j]] = [order[j], order[i]];
      assign(order, flips);
      const next = spread();
      if (next <= score) score = next;
      else if (flip) flips[i] = !flips[i];
      else [order[i], order[j]] = [order[j], order[i]];
    }
    if (!best || score < best.score) best = { score, order: [...order], flips: [...flips] };
  }
  assign(best.order, best.flips);

  if (sides === 6) {
    // 1, 2, 3 counter-clockwise round their corner, seen from outside (the usual Western die).
    const normal = (value) => faceNormal(vertices, faces[values.indexOf(value)]);
    if (dot(normal(1), cross(normal(2), normal(3))) < 0) {
      const two = values.indexOf(2);
      const five = values.indexOf(5);
      values[two] = 5;
      values[five] = 2;
    }
  }
  return values;
}

function labelsFor(values, { sides, tens, zero, mark }) {
  const shift = zero && sides === 10 ? -1 : 0;
  const text = values.map((value) => {
    const n = value + shift;
    if (tens) return n === 0 ? "00" : String(n * 10);
    return String(n);
  });
  if (!mark) return text;
  // A number that reads as another number on this die when turned upside down gets a dot.
  const flip = { 0: "0", 1: "1", 6: "9", 8: "8", 9: "6" };
  const all = new Set(text);
  return text.map((label) => {
    const upside = [...label].reverse().map((digit) => flip[digit]);
    if (upside.includes(undefined)) return label;
    const turned = upside.join("");
    return turned !== label && all.has(turned) ? `${label}.` : label;
  });
}

// ---- Placing a number on a face --------------------------------------------------------------------------------------

/**
 * The turn that lays layerling's text (letters in x, z; standing up along y; read along x with their tops towards -z)
 * onto a face: up the face along `up`, out of it along `normal`. As layerling's angles: XYZ Euler, in degrees.
 */
function textAngles(normal, up) {
  const right = cross(up, normal);
  // Columns: where x, y and z of the text go.
  const m = [
    [right[0], normal[0], -up[0]],
    [right[1], normal[1], -up[1]],
    [right[2], normal[2], -up[2]],
  ];
  const degrees = (radians) => Math.round(((radians * 180) / Math.PI) * 1e4) / 1e4;
  const ry = Math.asin(Math.max(-1, Math.min(1, m[0][2])));
  let rx;
  let rz;
  if (Math.abs(m[0][2]) < 0.9999999) {
    rx = Math.atan2(-m[1][2], m[2][2]);
    rz = Math.atan2(-m[0][1], m[0][0]);
  } else {
    rx = Math.atan2(m[2][1], m[1][1]);
    rz = 0;
  }
  return { rotationX: degrees(rx), rotation: degrees(ry), rotationZ: degrees(rz) };
}

/** A text part standing on a face, from `below` mm under it to `above` mm over it. */
function textPart({ label, centre, normal, up, height, width, below, above, font, color, hole }) {
  const thickness = below + above;
  const middle = add(centre, mul(normal, (above - below) / 2));
  return {
    kind: "text",
    name: hole ? `Recess ${label}` : `Number ${label}`,
    text: label,
    font,
    width,
    depth: height,
    height: thickness,
    x: round(middle[0]),
    z: round(middle[2]),
    // Shapes turn about their middle: the bottom of the unturned text is half its thickness below it.
    elevation: round(middle[1] - thickness / 2),
    ...textAngles(normal, up),
    ...(hole ? { hole: true } : { color }),
  };
}

const round = (value) => Math.round(value * 1e4) / 1e4;

/** Which way a number's top points on a face. */
function faceUp(sides, vertices, face, normal, centre) {
  const corners = face.map((index) => vertices[index]);
  const flatten = (direction) => sub(direction, mul(normal, dot(direction, normal)));
  if (sides === 10) {
    // Towards the kite's far point, as on a bought D10.
    const far = corners.reduce((best, corner) => (length(sub(corner, centre)) > length(sub(best, centre)) ? corner : best));
    return unit(flatten(sub(far, centre)));
  }
  // Squares: towards the middle of an edge. Triangles and pentagons: towards a corner. The one nearest the back (or the
  // top, on a sloping face), so the numbers on the visible faces read the right way up.
  const targets = corners.length === 4
    ? corners.map((corner, index) => mul(add(corner, corners[(index + 1) % 4]), 0.5))
    : corners;
  const reference = Math.abs(normal[1]) > 0.9 ? [0, 0, -1] : [0, 1, 0];
  const best = targets.reduce((winner, target) => (dot(sub(target, centre), reference) > dot(sub(winner, centre), reference) ? target : winner));
  return unit(flatten(sub(best, centre)));
}

// ---- The die ----------------------------------------------------------------------------------------------------------

function buildDice(values) {
  const sides = Number(values.sides);
  const style = String(values.style);
  const depth = Number(values.depth);
  const scaleText = Number(values.numberSize) / 100;
  const font = String(values.font);
  const diceColor = String(values.diceColor);
  const numberColor = String(values.numberColor);

  // Number the faces on the unturned solid, then turn it so the highest number is on top: a spin-down starts at 20.
  const solid = baseSolid(sides);
  const numbers = numberFaces(sides, solid, String(values.order), values.loop === true);
  const labels = labelsFor(numbers, { sides, tens: values.values === "tens", zero: values.zero === true, mark: values.mark === true });

  const normals = solid.faces.map((face) => faceNormal(solid.vertices, face));
  let downFace;
  if (sides === 4) {
    // The D4 reads its top corner: stand it on the face opposite the corner with the highest number.
    const top = numbers.indexOf(4);
    downFace = solid.faces.findIndex((face) => !face.includes(top));
  } else {
    const top = numbers.indexOf(Math.max(...numbers));
    downFace = normals.reduce((best, normal, index) => (dot(normal, normals[top]) < dot(normals[best], normals[top]) ? index : best), 0);
  }
  const turn = rotationBetween(normals[downFace], [0, -1, 0]);
  let vertices = solid.vertices.map(turn);

  // Sized by its height on the plate, centred, standing on y = 0.
  const ys = vertices.map((vertex) => vertex[1]);
  const scale = Number(values.size) / (Math.max(...ys) - Math.min(...ys));
  vertices = vertices.map((vertex) => mul(vertex, scale));
  const min = [0, 1, 2].map((axis) => Math.min(...vertices.map((vertex) => vertex[axis])));
  const max = [0, 1, 2].map((axis) => Math.max(...vertices.map((vertex) => vertex[axis])));
  const shift = [-(min[0] + max[0]) / 2, -min[1], -(min[2] + max[2]) / 2];
  vertices = vertices.map((vertex) => add(vertex, shift));
  const faces = solid.faces;

  // Where each number goes: a face's middle (the biggest circle in it), or for a D4 each corner of each face.
  const placements = [];
  faces.forEach((face, faceIndex) => {
    const normal = faceNormal(vertices, face);
    const circle = inCircle(vertices, face, normal);
    if (sides === 4) {
      for (const corner of face) {
        const toward = sub(vertices[corner], circle.centre);
        placements.push({
          label: labels[corner],
          centre: add(circle.centre, mul(toward, 0.48)),
          normal,
          up: unit(sub(toward, mul(normal, dot(toward, normal)))),
          height: circle.radius * 0.62 * scaleText,
          width: circle.radius * 0.9 * scaleText,
        });
      }
      return;
    }
    const label = labels[faceIndex];
    const digits = label.replace(".", "").length;
    placements.push({
      label,
      centre: circle.centre,
      normal,
      up: faceUp(sides, vertices, face, normal, circle.centre),
      // A box the number is fitted into, keeping its proportions: the width limits numbers of several digits.
      height: circle.radius * (digits > 2 ? 0.75 : sides === 10 ? 0.95 : 1.05) * scaleText,
      width: circle.radius * (sides === 6 || sides === 3 ? 1.5 : 1.45) * scaleText,
    });
  });

  const body = { mesh: meshOf(vertices, faces), name: `D${sides} body`, color: diceColor };
  const name = `D${sides}${values.order === "spin" && sides !== 3 && sides !== 4 ? " spin-down" : ""}`;
  // The cut reaches 0.5 mm out of the face, so it opens cleanly through it.
  const recess = (placement) => textPart({ ...placement, font, below: depth, above: 0.5, hole: true });

  if (style === "recessed") {
    return { name, color: diceColor, parts: [body, ...placements.map(recess)] };
  }
  if (style === "raised") {
    // One body; Multicolor keeps the numbers' own colour on screen and in a 3MF.
    return {
      name,
      color: diceColor,
      multicolor: true,
      parts: [...placements.map((placement) => textPart({ ...placement, font, below: 0.2, above: depth, color: numberColor })), body],
    };
  }
  // Embedded: the body with the numbers cut in, and the numbers as a second body filling the cuts exactly,
  // bundled so they stay two objects in two colours.
  return {
    name,
    bundle: true,
    parts: [
      { name: `D${sides} body`, color: diceColor, parts: [body, ...placements.map(recess)] },
      { name: "Numbers", color: numberColor, parts: placements.map((placement) => textPart({ ...placement, font, below: depth, above: 0, color: numberColor })) },
    ],
  };
}