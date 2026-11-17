// A closed, printable solid from a height function: a top surface y = height(x, z) over a rectangle,
// a flat bottom at y = 0, and four walls. Units are mm; y is up, z points towards the front.
// Triangles are wound so their normals point outwards, which slicers and boolean operations expect.

export function heightfieldMesh({ width, depth, steps, height }) {
  const nx = Math.max(2, Math.round(steps));
  const nz = Math.max(2, Math.round(steps * (depth / width)));
  const xs = Array.from({ length: nx + 1 }, (_, i) => -width / 2 + (i * width) / nx);
  const zs = Array.from({ length: nz + 1 }, (_, j) => -depth / 2 + (j * depth) / nz);
  const top = (i, j) => [xs[i], Math.max(0.2, height(xs[i], zs[j])), zs[j]];
  const bottom = (i, j) => [xs[i], 0, zs[j]];
  const positions = [];
  const tri = (a, b, c) => positions.push(...a, ...b, ...c);

  for (let i = 0; i < nx; i += 1) {
    for (let j = 0; j < nz; j += 1) {
      // Top, facing up.
      tri(top(i, j), top(i, j + 1), top(i + 1, j + 1));
      tri(top(i, j), top(i + 1, j + 1), top(i + 1, j));
      // Bottom, facing down.
      tri(bottom(i, j), bottom(i + 1, j + 1), bottom(i, j + 1));
      tri(bottom(i, j), bottom(i + 1, j), bottom(i + 1, j + 1));
    }
  }
  for (let i = 0; i < nx; i += 1) {
    // Front wall (z = +depth/2) and back wall (z = -depth/2).
    tri(bottom(i, nz), bottom(i + 1, nz), top(i + 1, nz));
    tri(bottom(i, nz), top(i + 1, nz), top(i, nz));
    tri(bottom(i, 0), top(i + 1, 0), bottom(i + 1, 0));
    tri(bottom(i, 0), top(i, 0), top(i + 1, 0));
  }
  for (let j = 0; j < nz; j += 1) {
    // Right wall (x = +width/2) and left wall (x = -width/2).
    tri(bottom(nx, j), top(nx, j), top(nx, j + 1));
    tri(bottom(nx, j), top(nx, j + 1), bottom(nx, j + 1));
    tri(bottom(0, j), bottom(0, j + 1), top(0, j + 1));
    tri(bottom(0, j), top(0, j + 1), top(0, j));
  }
  return { positions };
}
