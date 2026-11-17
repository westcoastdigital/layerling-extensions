// A shape made from a generated mesh, with options that rebuild it from the inspector.
// heightfield.js shows that an extension can be split into modules with ordinary relative imports.
import { heightfieldMesh } from "./heightfield.js";

export default function activate(layerling) {
  layerling.registerShape({
    id: "wave-tile",
    name: "Wave tile",
    // An icon can also be a file in the extension's folder.
    icon: layerling.asset("icon.svg"),
    keywords: ["coaster", "texture", "pattern", "mesh"],
    options: [
      { key: "width", label: "Width", type: "number", default: 90, min: 10, max: 300, step: 1, unit: "mm" },
      { key: "depth", label: "Depth", type: "number", default: 90, min: 10, max: 300, step: 1, unit: "mm" },
      { key: "base", label: "Base", type: "number", default: 3, min: 0.6, max: 20, step: 0.2, unit: "mm" },
      { key: "amplitude", label: "Wave height", type: "number", default: 2, min: 0, max: 20, step: 0.2, unit: "mm" },
      { key: "waves", label: "Waves", type: "number", default: 4, min: 1, max: 20, step: 1 },
      { key: "pattern", label: "Pattern", type: "select", default: "ripple", options: [
        { value: "ripple", label: "Ripple (from the centre)" },
        { value: "egg", label: "Egg crate" },
        { value: "stripes", label: "Stripes" },
      ] },
      { key: "detail", label: "Detail", type: "select", default: "60", options: [
        { value: "30", label: "Draft" },
        { value: "60", label: "Normal" },
        { value: "120", label: "Fine" },
      ], help: "More detail means more triangles and slower editing" },
    ],
    build(values) {
      const width = Number(values.width);
      const depth = Number(values.depth);
      const base = Number(values.base);
      const amplitude = Number(values.amplitude);
      const k = (Number(values.waves) * 2 * Math.PI) / Math.max(width, depth);
      const wave = {
        ripple: (x, z) => Math.cos(k * Math.hypot(x, z)),
        egg: (x, z) => Math.sin(k * x) * Math.sin(k * z),
        stripes: (x) => Math.sin(k * x),
      }[values.pattern] ?? (() => 0);
      return {
        name: `Wave tile ${width} x ${depth}`,
        color: "#4f9d8c",
        // y = 0 is the bottom; heights stay at least base above it.
        mesh: heightfieldMesh({ width, depth, steps: Number(values.detail), height: (x, z) => base + amplitude * (1 + wave(x, z)) / 2 }),
      };
    },
  });
}
