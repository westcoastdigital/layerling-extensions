// Example layerling extension. Plain ES module: no build step, edit and reload the page.
// The full API is described in ../../README.md and overlay/apps/web/src/lib/extensions/types.ts.

const ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#c3731f" stroke-width="1.8" stroke-linejoin="round"><path d="M4 7l8-4 8 4v10l-8 4-8-4z"/><path d="M4 7l8 4 8-4M12 11v10"/></svg>`;

// Card thickness per sleeve type, mm.
const SLEEVES = {
  none: { label: "Unsleeved", thickness: 0.31, width: 63, height: 88 },
  standard: { label: "Standard sleeves", thickness: 0.5, width: 66, height: 91 },
  double: { label: "Double sleeved", thickness: 0.65, width: 67, height: 92 },
};

export default function activate(layerling) {
  // ---- Settings: one page under Settings > Extensions, stored in the extension data folder -------------------
  layerling.registerSettings({
    title: "Printer",
    options: [
      { key: "clearance", label: "Clearance", type: "number", default: 0.6, min: 0, max: 3, step: 0.05, unit: "mm", help: "Added on every side of the cards" },
      { key: "color", label: "Default colour", type: "color", default: "#3b6ea8" },
    ],
  });

  // ---- A custom shape: built from layerling's own box and a box hole, grouped ---------------------------------
  layerling.registerShape({
    id: "deck-box",
    name: "Deck box",
    icon: ICON,
    keywords: ["mtg", "cards", "commander", "box"],
    options: [
      { key: "cards", label: "Cards", type: "number", default: 100, min: 10, max: 400, step: 1 },
      { key: "sleeves", label: "Sleeves", type: "select", default: "double", options: Object.entries(SLEEVES).map(([value, s]) => ({ value, label: s.label })) },
      { key: "wall", label: "Wall", type: "number", default: 2, min: 0.8, max: 6, step: 0.1, unit: "mm" },
      { key: "floor", label: "Floor", type: "number", default: 1.6, min: 0.6, max: 6, step: 0.1, unit: "mm" },
      { key: "landscape", label: "Cards lying down", type: "boolean", default: false },
    ],
    build(values, { settings }) {
      const sleeve = SLEEVES[values.sleeves] ?? SLEEVES.double;
      const gap = Number(settings.clearance ?? 0.6);
      const wall = Number(values.wall);
      const floor = Number(values.floor);
      const stack = Number(values.cards) * sleeve.thickness;
      const innerW = sleeve.width + gap * 2;
      const innerD = stack + gap * 2;
      const innerH = values.landscape ? sleeve.width + gap : sleeve.height + gap;
      const width = values.landscape ? sleeve.height + gap * 2 : innerW;
      const outer = { width: width + wall * 2, depth: innerD + wall * 2, height: innerH + floor };
      return {
        name: `Deck box (${values.cards})`,
        color: String(settings.color ?? "#3b6ea8"),
        parts: [
          // x and z are the centre on the plate, elevation the bottom, all in mm.
          { kind: "box", width: outer.width, depth: outer.depth, height: outer.height, x: 0, z: 0, elevation: 0 },
          // A hole sticking 1 mm out of the top, so the top is open.
          { kind: "box", hole: true, width: outer.width - wall * 2, depth: innerD, height: innerH + 1, x: 0, z: 0, elevation: floor },
        ],
      };
    },
  });

  // ---- Menu items ----------------------------------------------------------------------------------------------
  layerling.registerMenuItem({
    id: "insert-deck-box",
    label: "Insert deck box",
    menu: ["toolbar", "commandPalette"],
    icon: ICON,
    keywords: ["mtg", "cards"],
    enabled: () => layerling.editor.available(),
    run: () => layerling.editor.insertShape("deck-box"),
  });

  layerling.registerMenuItem({
    id: "copy-size",
    label: "Copy size to clipboard",
    menu: ["shapeContext", "commandPalette"],
    when: (ctx) => ctx.selected.length === 1,
    run: async (ctx) => {
      const s = ctx.selected[0];
      const text = `${round(s.width)} x ${round(s.depth)} x ${round(s.height)} mm`;
      await navigator.clipboard.writeText(text);
      layerling.notify(`Copied ${text}`);
    },
  });

  layerling.registerMenuItem({
    id: "lid-for-box",
    label: "Add a slip lid",
    menu: "shapeContext",
    // Only for deck boxes this extension made.
    when: (ctx) => ctx.selected.length === 1 && layerling.editor.data(ctx.selected[0].id)?.shape === "deck-box",
    run: async (ctx) => {
      const box = ctx.selected[0];
      const wall = Number(layerling.editor.data(box.id)?.values?.wall ?? 2);
      const gap = Number(layerling.settings.get("clearance") ?? 0.6) / 2;
      // A cap that slides over the box: its own box with a hole the size of the box plus clearance.
      const outer = await layerling.editor.run("create_shape", {
        kind: "box", width: box.width + (wall + gap) * 2, depth: box.depth + (wall + gap) * 2, height: 25,
        x: box.x + box.width + 20, z: box.z, elevation: 0,
      });
      const hole = await layerling.editor.run("create_shape", {
        kind: "box", hole: true, width: box.width + gap * 2, depth: box.depth + gap * 2, height: 25,
        x: box.x + box.width + 20, z: box.z, elevation: wall,
      });
      const lid = await layerling.editor.run("group_objects", { ids: [outer.object.id, hole.object.id] });
      await layerling.editor.run("update_object", { id: lid.object.id, name: `${box.name} lid`, color: box.color });
    },
  });

  layerling.registerMenuItem({
    id: "copy-project-name",
    label: "Copy design name",
    menu: "dashboardProject",
    run: async (ctx) => {
      await navigator.clipboard.writeText(ctx.projectName ?? "");
      layerling.notify(`Copied "${ctx.projectName}"`);
    },
  });

  // ---- Options on any object: stored on the object, saved with the design ------------------------------------
  layerling.registerShapeOptions({
    id: "print-notes",
    title: "Print notes",
    appliesTo: (shape) => !shape.hole,
    options: [
      { key: "material", label: "Material", type: "select", default: "pla", options: [
        { value: "pla", label: "PLA" }, { value: "petg", label: "PETG" }, { value: "tpu", label: "TPU" }, { value: "abs", label: "ABS/ASA" },
      ] },
      { key: "supports", label: "Needs supports", type: "boolean", default: false },
      { key: "note", label: "Note", type: "text", default: "", placeholder: "e.g. print upside down" },
    ],
    apply: (shape, values) => {
      layerling.notify(`${shape.name}: ${values.material.toUpperCase()}${values.supports ? ", with supports" : ""}`);
    },
  });

  // ---- Listening to the editor ----------------------------------------------------------------------------------
  const stop = layerling.editor.on("change", () => {
    // Runs at most once per frame while a design is open. Keep it cheap.
  });
  layerling.onDispose(stop);
}

function round(value) {
  return Math.round(value * 100) / 100;
}
