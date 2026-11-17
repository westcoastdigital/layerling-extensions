// The smallest useful layerling extension. Copy this folder, rename it, and edit.
// No build step: save the file and reload the page.

// Any SVG works as an icon. Keep it 24x24.
const ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#c3731f" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/></svg>`;

// layerling calls this once when the page loads. `layerling` is the extension API.
export default function activate(layerling) {
  // 1. A setting, shown under Settings > Extensions > Hello world.
  layerling.registerSettings({
    options: [
      { key: "gap", label: "Gap between objects", type: "number", default: 5, min: 0, max: 100, step: 0.5, unit: "mm" },
    ],
  });

  // 2. A button in the "Extensions" ribbon group, also found with Ctrl+K.
  layerling.registerMenuItem({
    id: "say-hello",
    label: "Say hello",
    menu: ["toolbar", "commandPalette"],
    icon: ICON,
    // Greyed out on the dashboard, where no design is open.
    enabled: () => layerling.editor.available(),
    run: () => {
      const count = layerling.editor.shapes().length;
      layerling.notify(`Hello! This design has ${count} object${count === 1 ? "" : "s"}.`);
    },
  });

  // 3. A right-click item that only shows when two or more objects are selected.
  layerling.registerMenuItem({
    id: "line-up",
    label: "Line up in a row",
    menu: ["shapeContext", "commandPalette"],
    when: (ctx) => ctx.selected.length > 1,
    run: async (ctx) => {
      const gap = Number(layerling.settings.get("gap") ?? 5);
      // x and z are an object's centre; width is its size along x.
      const objects = [...ctx.selected].sort((a, b) => a.x - b.x);
      let left = objects[0].x - objects[0].width / 2;
      for (const object of objects) {
        // editor.run() takes any of layerling's commands; update_object moves, resizes, renames, recolours ...
        await layerling.editor.run("update_object", { id: object.id, x: left + object.width / 2, z: objects[0].z });
        left += object.width + gap;
      }
      layerling.notify(`Lined up ${objects.length} objects, ${gap} mm apart.`);
    },
  });
}
