import type { WorkplaneShape } from "@/types/layerling";

/** A field an extension asks for: in the shape inspector, the settings page or a shape's own options. */
export type ExtensionOption =
  | { key: string; label: string; type: "number"; default?: number; min?: number; max?: number; step?: number; unit?: string; help?: string }
  | { key: string; label: string; type: "select"; default?: string; options: { value: string; label: string }[]; help?: string }
  | { key: string; label: string; type: "boolean"; default?: boolean; help?: string }
  | { key: string; label: string; type: "text"; default?: string; placeholder?: string; help?: string }
  | { key: string; label: string; type: "color"; default?: string; help?: string };

export type ExtensionValue = string | number | boolean;
export type ExtensionValues = Record<string, ExtensionValue>;

/** extension.json in an extension's folder. */
export type ExtensionManifest = {
  id: string;
  name: string;
  version?: string;
  description?: string;
  author?: string;
  /** The ES module to import, relative to the folder. Default index.js. */
  main?: string;
  /** Stylesheets to add to the page, relative to the folder. */
  styles?: string[];
  /** The newest layerling version this was tested with; shown only. */
  layerling?: string;
};

/** What the server lists: the manifest plus where its files are served from. */
export type ExtensionListing = ExtensionManifest & { baseUrl: string; enabled: boolean; error?: string };

export type MenuName = "shapeContext" | "commandPalette" | "toolbar" | "dashboardProject";

export type MenuContext = {
  menu: MenuName;
  /** Selected object ids in the editor (empty on the dashboard). */
  selection: string[];
  /** The selected objects themselves. */
  selected: WorkplaneShape[];
  /** Dashboard project menu only. */
  projectId?: string;
  projectName?: string;
};

export type MenuItemDef = {
  id: string;
  label: string;
  menu: MenuName | MenuName[];
  /** Toolbar and palette: an SVG string or a URL (use api.asset("icon.svg")). */
  icon?: string;
  shortcut?: string;
  danger?: boolean;
  /** Draw a separator above it (context menus). */
  separated?: boolean;
  keywords?: string[];
  /** Hide the item when this returns false. */
  when?: (ctx: MenuContext) => boolean;
  /** Grey it out when this returns false (toolbar and palette). */
  enabled?: (ctx: MenuContext) => boolean;
  run: (ctx: MenuContext) => void | Promise<void>;
};

/** A triangle mesh in mm: x across, y up, z towards the front. It stands exactly where its coordinates say. */
export type MeshSpec = { positions: number[]; normals?: number[] };

/** How the parts of a group come together. */
export type GroupSpec = {
  /** true: a bundle - every part stays a body of its own in its own colour, and holes cut nothing (Ctrl+B). */
  bundle?: boolean;
  /** Show and export each part in its own colour (a group of solids normally takes one colour). */
  multicolor?: boolean;
  name?: string;
  color?: string;
};

/**
 * One part of an extension shape:
 * - the parameters of layerling's own create_shape (kind, width, depth, height, x, z, elevation, hole, rotation ...);
 * - a mesh of your own: { mesh, name?, color?, hole? };
 * - a group of parts of its own: { parts, bundle?, multicolor?, name?, color? }.
 */
export type ShapePartSpec =
  | ({ kind: string } & Record<string, unknown>)
  | { mesh: MeshSpec; name?: string; color?: string; hole?: boolean }
  | ({ parts: ShapePartSpec[] } & GroupSpec);

export type ShapeBuildResult =
  /** Built from parts; two or more are grouped (holes cut), or bundled. */
  | ({ parts: ShapePartSpec[] } & GroupSpec)
  /** A single triangle mesh. */
  | { mesh: MeshSpec; name?: string; color?: string };

export type ShapeDef = {
  id: string;
  name: string;
  /** An SVG string or a URL (api.asset("deck-box.svg")). */
  icon?: string;
  keywords?: string[];
  options?: ExtensionOption[];
  build: (values: ExtensionValues, ctx: BuildContext) => ShapeBuildResult | Promise<ShapeBuildResult>;
};

export type BuildContext = {
  /** This extension's current settings. */
  settings: ExtensionValues;
  /** The shape being rebuilt, when its options changed. */
  previous?: WorkplaneShape;
};

/** A card in the inspector for objects this extension did not make (or did). */
export type ShapeOptionsDef = {
  id: string;
  title: string;
  appliesTo: (shape: WorkplaneShape) => boolean;
  options: ExtensionOption[] | ((shape: WorkplaneShape) => ExtensionOption[]);
  /** Called with the new values once stored on the object; change the design here if the options mean that. */
  apply?: (shape: WorkplaneShape, values: ExtensionValues, ctx: { settings: ExtensionValues }) => void | Promise<void>;
};

export type SettingsDef = {
  title?: string;
  options: ExtensionOption[];
};

/** What an extension keeps on an object, under shape.extensions[extensionId]. Saved with the design. */
export type ShapeExtensionData = {
  /** Made by registerShape(id). */
  shape?: string;
  /** The values it was built with. */
  values?: ExtensionValues;
  /** The name build() gave it, so a rebuild can tell a name typed by hand from its own. */
  builtName?: string;
  /** Values of registerShapeOptions cards, by card id. */
  panels?: Record<string, ExtensionValues>;
  /** Anything else the extension wants to keep. */
  data?: unknown;
};

export type ShapeWithExtensions = WorkplaneShape & { extensions?: Record<string, ShapeExtensionData> };

export type EditorEvent = "change";

/** What `activate(api)` gets. */
export type ExtensionApi = {
  id: string;
  /** 2: shapes can have mesh parts and groups of parts. Missing on hosts before that. */
  apiVersion: number;
  manifest: ExtensionManifest;
  /** URL of a file in the extension's folder. */
  asset: (path: string) => string;
  registerShape: (def: ShapeDef) => void;
  registerMenuItem: (def: MenuItemDef) => void;
  registerShapeOptions: (def: ShapeOptionsDef) => void;
  registerSettings: (def: SettingsDef) => void;
  settings: {
    all: () => ExtensionValues;
    get: <T extends ExtensionValue = ExtensionValue>(key: string) => T | undefined;
    set: (key: string, value: ExtensionValue) => Promise<void>;
    onChange: (listener: (values: ExtensionValues) => void) => () => void;
  };
  editor: {
    /** False on the dashboard: no design is open. */
    available: () => boolean;
    /** Any of layerling's MCP commands (create_shape, update_object, group_objects, boolean_cut ...). */
    run: <T = unknown>(action: string, params?: Record<string, unknown>) => Promise<T>;
    shapes: () => ShapeWithExtensions[];
    selection: () => string[];
    shape: (id: string) => ShapeWithExtensions | null;
    /** This extension's data on an object. */
    data: (id: string) => ShapeExtensionData | undefined;
    setData: (id: string, data: ShapeExtensionData | undefined) => void;
    /** Insert one of this extension's registered shapes; returns the new object's id. */
    insertShape: (shapeId: string, values?: ExtensionValues, place?: { x?: number; z?: number; elevation?: number }) => Promise<string>;
    on: (event: EditorEvent, listener: () => void) => () => void;
  };
  notify: (message: string) => void;
  onDispose: (fn: () => void) => void;
};

export type ExtensionModule = {
  default?: (api: ExtensionApi) => void | (() => void) | Promise<void | (() => void)>;
  activate?: (api: ExtensionApi) => void | (() => void) | Promise<void | (() => void)>;
};