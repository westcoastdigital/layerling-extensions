"use client";

import type { WorkplaneShape } from "@/types/layerling";
import type {
  ExtensionApi,
  ExtensionListing,
  ExtensionModule,
  ExtensionOption,
  ExtensionValue,
  ExtensionValues,
  MenuContext,
  MenuItemDef,
  MenuName,
  SettingsDef,
  ShapeDef,
  ShapeExtensionData,
  ShapeOptionsDef,
  ShapeWithExtensions,
} from "@/lib/extensions/types";

/**
 * The extension host: loads every extension the server lists, keeps what they register, and gives them the open
 * editor. Everything an extension does goes through try/catch here, so a broken extension shows a message and
 * leaves layerling running.
 */

const API_ROUTE = "/api/extensions";
const LOCAL_SETTINGS_KEY = "layerling.extensionSettings";
const LOCAL_DISABLED_KEY = "layerling.extensionsDisabled";

/** What the editor hands over while a design is open (LayerlingEditor, one effect). */
export type ExtensionEditorBridge = {
  run: (action: string, params: Record<string, unknown>) => Promise<unknown>;
  shapes: () => WorkplaneShape[];
  selection: () => string[];
  /** Stores data under shape.extensions[extensionId], amending the newest undo step. */
  setShapeExtensionData: (id: string, extensionId: string, data: ShapeExtensionData | undefined) => void;
  notice: (message: string) => void;
};

type Registered<T> = T & { extensionId: string };

type LoadedExtension = ExtensionListing & {
  status: "loading" | "active" | "failed" | "disabled";
  error?: string;
  settingsDef?: SettingsDef;
  dispose: (() => void)[];
};

const state = {
  started: false,
  storage: "browser" as "server" | "browser",
  extensions: [] as LoadedExtension[],
  shapes: [] as Registered<ShapeDef>[],
  menuItems: [] as Registered<MenuItemDef>[],
  shapeOptions: [] as Registered<ShapeOptionsDef>[],
  settings: {} as Record<string, ExtensionValues>,
  settingsListeners: new Map<string, Set<(values: ExtensionValues) => void>>(),
  editor: null as ExtensionEditorBridge | null,
  editorListeners: new Set<() => void>(),
  version: 0,
  listeners: new Set<() => void>(),
};

// ---- React side: one version number for "something registered or a setting changed" ------------------------------

export function subscribeExtensions(listener: () => void) {
  state.listeners.add(listener);
  return () => state.listeners.delete(listener);
}

export function extensionsVersion() {
  return state.version;
}

function bump() {
  state.version += 1;
  state.listeners.forEach((listener) => listener());
}

export function installedExtensions(): readonly LoadedExtension[] {
  return state.extensions;
}

export function extensionStorage() {
  return state.storage;
}

// ---- The editor bridge ----------------------------------------------------------------------------------------------

let editorChangeQueued = false;

export function connectExtensionEditor(bridge: ExtensionEditorBridge) {
  state.editor = bridge;
  bump();
  extensionEditorChanged();
  return () => {
    if (state.editor === bridge) {
      state.editor = null;
      bump();
    }
  };
}

/** Called by the editor whenever its shapes or selection change; extensions hear it once per frame at most. */
export function extensionEditorChanged() {
  if (editorChangeQueued || state.editorListeners.size === 0) return;
  editorChangeQueued = true;
  requestAnimationFrame(() => {
    editorChangeQueued = false;
    state.editorListeners.forEach((listener) => guard("editor change", listener));
  });
}

function requireEditor() {
  if (!state.editor) throw new Error("Open a design first");
  return state.editor;
}

/** Lets React render and the editor refresh its callbacks between two commands. */
function settle() {
  return new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
}

async function runCommand<T = unknown>(action: string, params: Record<string, unknown> = {}) {
  const result = (await requireEditor().run(action, params)) as T;
  await settle();
  return result;
}

function objectId(result: unknown): string {
  const id = (result as { object?: { id?: unknown } } | null)?.object?.id;
  if (typeof id !== "string") throw new Error("The editor did not return the new object");
  return id;
}

export function extensionData(shape: WorkplaneShape | null | undefined, extensionId: string): ShapeExtensionData | undefined {
  return (shape as ShapeWithExtensions | null | undefined)?.extensions?.[extensionId];
}

// ---- Errors -------------------------------------------------------------------------------------------------------

function report(extensionId: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[layerling extension ${extensionId}]`, error);
  const text = `${extensionName(extensionId)}: ${message}`;
  if (state.editor) state.editor.notice(text);
  else if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("layerling-extension-error", { detail: text }));
}

export function reportExtensionError(extensionId: string, error: unknown) {
  report(extensionId, error);
}

function guard(extensionId: string, fn: () => unknown) {
  try {
    const result = fn();
    if (result instanceof Promise) result.catch((error) => report(extensionId, error));
    return result;
  } catch (error) {
    report(extensionId, error);
    return undefined;
  }
}

function extensionName(id: string) {
  return state.extensions.find((extension) => extension.id === id)?.name ?? id;
}

// ---- Settings -----------------------------------------------------------------------------------------------------

export function defaultValues(options: readonly ExtensionOption[] | undefined): ExtensionValues {
  const values: ExtensionValues = {};
  for (const option of options ?? []) {
    if (option.default !== undefined) values[option.key] = option.default;
    else if (option.type === "number") values[option.key] = option.min ?? 0;
    else if (option.type === "boolean") values[option.key] = false;
    else if (option.type === "select") values[option.key] = option.options[0]?.value ?? "";
    else if (option.type === "color") values[option.key] = "#888888";
    else values[option.key] = "";
  }
  return values;
}

export function extensionSettings(extensionId: string): ExtensionValues {
  const def = state.extensions.find((extension) => extension.id === extensionId)?.settingsDef;
  return { ...defaultValues(def?.options), ...state.settings[extensionId] };
}

function readLocal<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeLocal(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private windows may refuse; the values still hold until the page reloads.
  }
}

export async function saveExtensionSettings(extensionId: string, values: ExtensionValues) {
  state.settings = { ...state.settings, [extensionId]: { ...values } };
  bump();
  state.settingsListeners.get(extensionId)?.forEach((listener) => guard(extensionId, () => listener(extensionSettings(extensionId))));
  if (state.storage === "server") {
    const response = await fetch(API_ROUTE, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings: extensionId, values }),
    });
    if (response.ok) return;
    if (response.status !== 501) throw new Error(`Saving the settings failed (${response.status})`);
    state.storage = "browser";
  }
  writeLocal(LOCAL_SETTINGS_KEY, state.settings);
}

export async function setExtensionEnabled(extensionId: string, enabled: boolean) {
  const disabled = state.extensions.filter((extension) => (extension.id === extensionId ? !enabled : !extension.enabled)).map((extension) => extension.id);
  const target = state.extensions.find((extension) => extension.id === extensionId);
  if (target) target.enabled = enabled;
  state.extensions = [...state.extensions];
  bump();
  if (state.storage === "server") {
    const response = await fetch(API_ROUTE, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ disabled }) });
    if (response.ok) return;
    if (response.status !== 501) throw new Error(`Saving failed (${response.status})`);
    state.storage = "browser";
  }
  writeLocal(LOCAL_DISABLED_KEY, disabled);
}

// ---- Shapes made by extensions -------------------------------------------------------------------------------------

async function buildShape(def: Registered<ShapeDef>, values: ExtensionValues, previous?: WorkplaneShape) {
  const result = await def.build(values, { settings: extensionSettings(def.extensionId), previous });
  let id: string;
  const name = result.name ?? def.name;
  if ("mesh" in result) {
    id = objectId(await runCommand("import_mesh", {
      positions: result.mesh.positions,
      normals: result.mesh.normals,
      name,
      ...(result.color ? { color: result.color } : {}),
    }));
  } else {
    if (!result.parts?.length) throw new Error(`${def.name}: build() returned no parts`);
    const ids: string[] = [];
    try {
      for (const part of result.parts) {
        // Elevation is always given, so parts stand where the extension put them, not on a face workplane.
        ids.push(objectId(await runCommand("create_shape", { elevation: 0, ...part })));
      }
      id = ids.length > 1 ? objectId(await runCommand("group_objects", { ids })) : ids[0];
    } catch (error) {
      // Leave nothing half-built behind.
      const left = ids.filter((partId) => requireEditor().shapes().some((shape) => shape.id === partId));
      if (left.length) await runCommand("delete_objects", { ids: left }).catch(() => undefined);
      throw error;
    }
    await runCommand("update_object", { id, name, ...(result.color ? { color: result.color } : {}) });
  }
  requireEditor().setShapeExtensionData(id, def.extensionId, { ...extensionData(previous, def.extensionId), shape: def.id, values: { ...values }, builtName: name });
  await settle();
  return id;
}

export function extensionShapes(): readonly Registered<ShapeDef>[] {
  return state.shapes;
}

export async function insertExtensionShape(extensionId: string, shapeId: string, values?: ExtensionValues, place?: { x?: number; z?: number; elevation?: number }) {
  const def = state.shapes.find((shape) => shape.extensionId === extensionId && shape.id === shapeId);
  if (!def) throw new Error(`No shape ${shapeId} in ${extensionId}`);
  const id = await buildShape(def, { ...defaultValues(def.options), ...values });
  if (place && (place.x !== undefined || place.z !== undefined || place.elevation !== undefined)) await runCommand("update_object", { id, ...place });
  return id;
}

/** Inserts from the shape library, with errors shown as a notice. */
export function insertExtensionShapeFromLibrary(def: Registered<ShapeDef>) {
  void insertExtensionShape(def.extensionId, def.id).catch((error) => report(def.extensionId, error));
}

/** Builds an extension shape again with new values, where the old one stood, and removes the old one. */
export async function rebuildExtensionShape(shape: WorkplaneShape, extensionId: string, values: ExtensionValues) {
  const data = extensionData(shape, extensionId);
  const def = state.shapes.find((entry) => entry.extensionId === extensionId && entry.id === data?.shape);
  if (!def) throw new Error("The extension that made this object is not installed");
  if (shape.locked || shape.shapeLocked) throw new Error("Unlock the object first");
  const id = await buildShape(def, values, shape);
  // A name or colour changed by hand stays; one the extension gave follows the new build.
  const renamed = data?.builtName !== undefined && shape.name !== data.builtName;
  await runCommand("update_object", {
    id,
    ...(renamed ? { name: shape.name } : {}),
    color: shape.color,
    x: shape.x,
    z: shape.z,
    elevation: shape.elevation ?? 0,
    rotation: shape.rotation ?? 0,
    rotationX: shape.rotationX ?? 0,
    rotationZ: shape.rotationZ ?? 0,
    ...(shape.hole ? { hole: true } : {}),
  });
  await runCommand("delete_objects", { ids: [shape.id] });
  await runCommand("select_objects", { ids: [id] });
  return id;
}

export function shapeDefFor(shape: WorkplaneShape): { def: Registered<ShapeDef>; values: ExtensionValues } | null {
  const all = (shape as ShapeWithExtensions).extensions;
  if (!all) return null;
  for (const [extensionId, data] of Object.entries(all)) {
    if (!data?.shape) continue;
    const def = state.shapes.find((entry) => entry.extensionId === extensionId && entry.id === data.shape);
    if (def) return { def, values: { ...defaultValues(def.options), ...data.values } };
  }
  return null;
}

// ---- Option cards for any object -----------------------------------------------------------------------------------

export function shapeOptionCards(shape: WorkplaneShape) {
  return state.shapeOptions.flatMap((card) => {
    const applies = guard(card.extensionId, () => card.appliesTo(shape));
    if (applies !== true) return [];
    const options = (typeof card.options === "function" ? guard(card.extensionId, () => (card.options as (s: WorkplaneShape) => ExtensionOption[])(shape)) : card.options) as ExtensionOption[] | undefined;
    if (!options?.length) return [];
    const stored = extensionData(shape, card.extensionId)?.panels?.[card.id];
    return [{ card, options, values: { ...defaultValues(options), ...stored } }];
  });
}

export async function applyShapeOptionCard(shape: WorkplaneShape, card: Registered<ShapeOptionsDef>, values: ExtensionValues) {
  const editor = requireEditor();
  const before = extensionData(shape, card.extensionId);
  editor.setShapeExtensionData(shape.id, card.extensionId, { ...before, panels: { ...before?.panels, [card.id]: { ...values } } });
  await settle();
  const updated = editor.shapes().find((entry) => entry.id === shape.id) ?? shape;
  await card.apply?.(updated, values, { settings: extensionSettings(card.extensionId) });
}

// ---- Menus ---------------------------------------------------------------------------------------------------------

export function menuContext(menu: MenuName, extra: Partial<MenuContext> = {}): MenuContext {
  const selection = state.editor?.selection() ?? [];
  const shapes = state.editor?.shapes() ?? [];
  return { menu, selection, selected: shapes.filter((shape) => selection.includes(shape.id)), ...extra };
}

export function extensionMenuItems(menu: MenuName, ctx: MenuContext) {
  return state.menuItems.filter((item) => {
    const menus = Array.isArray(item.menu) ? item.menu : [item.menu];
    if (!menus.includes(menu)) return false;
    return item.when ? guard(item.extensionId, () => item.when?.(ctx)) === true : true;
  });
}

export function menuItemEnabled(item: Registered<MenuItemDef>, ctx: MenuContext) {
  return item.enabled ? guard(item.extensionId, () => item.enabled?.(ctx)) === true : true;
}

export function runMenuItem(item: Registered<MenuItemDef>, ctx: MenuContext) {
  guard(item.extensionId, () => item.run(ctx));
}

// ---- Loading -------------------------------------------------------------------------------------------------------

function makeApi(listing: LoadedExtension): ExtensionApi {
  const id = listing.id;
  const own = <T extends object>(def: T) => ({ ...def, extensionId: id }) as Registered<T>;
  const replace = <T extends { id: string; extensionId: string }>(list: T[], entry: T) => [...list.filter((item) => !(item.extensionId === id && item.id === entry.id)), entry];
  return {
    id,
    manifest: listing,
    asset: (path) => new URL(path.replace(/^\/+/, ""), new URL(listing.baseUrl, window.location.origin)).toString(),
    registerShape: (def) => { state.shapes = replace(state.shapes, own(def)); bump(); },
    registerMenuItem: (def) => { state.menuItems = replace(state.menuItems, own(def)); bump(); },
    registerShapeOptions: (def) => { state.shapeOptions = replace(state.shapeOptions, own(def)); bump(); },
    registerSettings: (def) => {
      // The same object activate() finishes with, so its status and these settings stay together.
      listing.settingsDef = def;
      state.extensions = [...state.extensions];
      bump();
    },
    settings: {
      all: () => extensionSettings(id),
      get: <T extends ExtensionValue = ExtensionValue>(key: string) => extensionSettings(id)[key] as T | undefined,
      set: (key, value) => saveExtensionSettings(id, { ...state.settings[id], [key]: value }),
      onChange: (listener) => {
        const set = state.settingsListeners.get(id) ?? new Set();
        set.add(listener);
        state.settingsListeners.set(id, set);
        return () => set.delete(listener);
      },
    },
    editor: {
      available: () => state.editor !== null,
      run: (action, params = {}) => runCommand(action, params),
      shapes: () => (state.editor?.shapes() ?? []) as ShapeWithExtensions[],
      selection: () => state.editor?.selection() ?? [],
      shape: (shapeId) => (state.editor?.shapes().find((shape) => shape.id === shapeId) ?? null) as ShapeWithExtensions | null,
      data: (shapeId) => extensionData(state.editor?.shapes().find((shape) => shape.id === shapeId), id),
      setData: (shapeId, data) => requireEditor().setShapeExtensionData(shapeId, id, data),
      insertShape: (shapeId, values, place) => insertExtensionShape(id, shapeId, values, place),
      on: (_event, listener) => {
        state.editorListeners.add(listener);
        return () => state.editorListeners.delete(listener);
      },
    },
    notify: (message) => {
      if (state.editor) state.editor.notice(message);
      else window.dispatchEvent(new CustomEvent("layerling-extension-error", { detail: message }));
    },
    onDispose: (fn) => listing.dispose.push(fn),
  };
}

function addStyles(listing: ExtensionListing) {
  for (const style of listing.styles ?? []) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = new URL(style, new URL(listing.baseUrl, window.location.origin)).toString();
    link.dataset.layerlingExtension = listing.id;
    document.head.appendChild(link);
  }
}

async function activate(listing: LoadedExtension) {
  const url = new URL(listing.main ?? "index.js", new URL(listing.baseUrl, window.location.origin)).toString();
  try {
    addStyles(listing);
    const module = (await import(/* webpackIgnore: true */ url)) as ExtensionModule;
    const entry = module.activate ?? module.default;
    if (typeof entry !== "function") throw new Error(`${listing.main ?? "index.js"} has no default export or activate()`);
    const dispose = await entry(makeApi(listing));
    if (typeof dispose === "function") listing.dispose.push(dispose);
    listing.status = "active";
  } catch (error) {
    listing.status = "failed";
    listing.error = error instanceof Error ? error.message : String(error);
    console.error(`[layerling extension ${listing.id}] failed to load`, error);
  }
  state.extensions = [...state.extensions];
  bump();
}

/** Once per page: ask the server what is installed, then load what is switched on. */
export async function startExtensions() {
  if (state.started || typeof window === "undefined") return;
  state.started = true;
  let payload: { extensions?: ExtensionListing[]; settings?: Record<string, ExtensionValues>; storage?: "server" | "browser" } | null = null;
  try {
    const response = await fetch(API_ROUTE, { cache: "no-store" });
    // A layerling without the route (layerling.com, a static copy) simply has no extensions.
    if (!response.ok || !response.headers.get("content-type")?.includes("json")) return;
    payload = await response.json();
  } catch {
    return;
  }
  state.storage = payload?.storage === "server" ? "server" : "browser";
  const localDisabled = state.storage === "browser" ? readLocal<string[]>(LOCAL_DISABLED_KEY, []) : [];
  state.settings = state.storage === "server" ? { ...payload?.settings } : readLocal<Record<string, ExtensionValues>>(LOCAL_SETTINGS_KEY, {});
  state.extensions = (payload?.extensions ?? []).map((listing) => {
    const enabled = listing.enabled && !localDisabled.includes(listing.id) && !listing.error;
    return { ...listing, enabled: listing.enabled && !localDisabled.includes(listing.id), status: listing.error ? "failed" : enabled ? "loading" : "disabled", dispose: [] };
  });
  bump();
  await Promise.all(state.extensions.filter((extension) => extension.status === "loading").map(activate));
}
