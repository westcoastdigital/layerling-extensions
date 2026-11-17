"use client";

import { ChevronUp, Puzzle } from "lucide-react";
import { useCallback, useState, useSyncExternalStore, type CSSProperties } from "react";
import type { PaletteCommand } from "@/components/workplane/CommandPalette";
import type { ShapeContextMenuItem } from "@/components/workplane/ShapeContextMenu";
import {
  applyShapeOptionCard,
  extensionMenuItems,
  extensionSettings,
  extensionShapes,
  extensionStorage,
  extensionsVersion,
  installedExtensions,
  insertExtensionShapeFromLibrary,
  menuContext,
  menuItemEnabled,
  rebuildExtensionShape,
  reportExtensionError,
  runMenuItem,
  saveExtensionSettings,
  setExtensionEnabled,
  shapeDefFor,
  shapeOptionCards,
  subscribeExtensions,
} from "@/lib/extensions/host";
import type { ExtensionValues, MenuContext } from "@/lib/extensions/types";
import type { WorkplaneShape } from "@/types/layerling";
import { OptionFields } from "./OptionFields";

/**
 * The places in layerling where extensions show up. Each is one line in layerling's own files (see
 * patches/extension-hooks.patch); everything else lives here, so an update of layerling rarely touches it.
 */

/** Re-renders when an extension registers something or a setting changes. */
export function useExtensionsVersion() {
  return useSyncExternalStore(subscribeExtensions, extensionsVersion, () => 0);
}

/** An icon given as SVG markup or a URL, as something an <img> can show. */
function iconSource(icon: string | undefined) {
  if (!icon) return undefined;
  return icon.trim().startsWith("<") ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(icon)}` : icon;
}

function ExtensionIcon({ icon, size = 20 }: { icon?: string; size?: number }) {
  const src = iconSource(icon);
  return src ? <img className="extension-icon" src={src} alt="" width={size} height={size} draggable={false} /> : <Puzzle size={size} aria-hidden="true" />;
}

// ---- Right-click menu on objects ------------------------------------------------------------------------------------

/** ShapeContextMenu: core items, then the extensions' items for the selection. */
export function useExtensionContextMenuItems(items: ShapeContextMenuItem[]): ShapeContextMenuItem[] {
  useExtensionsVersion();
  const ctx = menuContext("shapeContext");
  const added = extensionMenuItems("shapeContext", ctx);
  if (!added.length) return items;
  return [
    ...items,
    ...added.map((item, index): ShapeContextMenuItem => ({
      key: `extension:${item.extensionId}:${item.id}`,
      label: item.label,
      shortcut: item.shortcut,
      danger: item.danger,
      separated: index === 0 || item.separated,
      onSelect: () => runMenuItem(item, menuContext("shapeContext")),
    })),
  ];
}

// ---- Command search (Ctrl+K) ----------------------------------------------------------------------------------------

export function useExtensionPaletteCommands(commands: PaletteCommand[]): PaletteCommand[] {
  useExtensionsVersion();
  const ctx = menuContext("commandPalette");
  const added = extensionMenuItems("commandPalette", ctx);
  if (!added.length) return commands;
  return [
    ...commands,
    ...added.map((item): PaletteCommand => ({
      id: `extension:${item.extensionId}:${item.id}`,
      label: item.label,
      group: installedExtensions().find((extension) => extension.id === item.extensionId)?.name ?? "Extensions",
      keywords: item.keywords,
      shortcut: item.shortcut,
      image: iconSource(item.icon),
      icon: item.icon ? undefined : Puzzle,
      enabled: menuItemEnabled(item, ctx),
      run: () => runMenuItem(item, menuContext("commandPalette")),
    })),
  ];
}

// ---- A ribbon group ------------------------------------------------------------------------------------------------

export function ExtensionToolbarSection({ disabled = false }: { disabled?: boolean }) {
  useExtensionsVersion();
  const ctx = menuContext("toolbar");
  const items = extensionMenuItems("toolbar", ctx);
  if (!items.length) return null;
  return (
    <div className="toolbar-section extension-toolbar-section" data-group="extensions" style={{ order: 900 }} inert={disabled}>
      <div className="toolbar-section-label">Extensions</div>
      <div className="toolbar-section-tools">
        {items.map((item) => {
          const enabled = menuItemEnabled(item, ctx);
          return (
            <button
              key={`${item.extensionId}:${item.id}`}
              type="button"
              className={`toolbar-icon ${enabled ? "" : "disabled"}`}
              aria-label={item.label}
              title={item.shortcut ? `${item.label} (${item.shortcut})` : item.label}
              aria-disabled={enabled ? undefined : true}
              onClick={enabled ? () => runMenuItem(item, menuContext("toolbar")) : undefined}
            >
              <ExtensionIcon icon={item.icon} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---- Shape library ------------------------------------------------------------------------------------------------

export function ExtensionShapeSection({ query = "" }: { query?: string }) {
  useExtensionsVersion();
  const [open, setOpen] = useState(true);
  const needle = query.trim().toLowerCase();
  const shapes = extensionShapes().filter((def) => !needle || [def.name, ...(def.keywords ?? [])].some((word) => word.toLowerCase().includes(needle)));
  if (!shapes.length) return null;
  return (
    <section className="shape-library-section extension-shape-section" aria-label="Extension shapes">
      <button type="button" className="shape-library-toggle" aria-expanded={open || Boolean(needle)} onClick={() => setOpen((value) => !value)}>
        <ChevronUp aria-hidden="true" style={{ transform: open || needle ? "rotate(180deg)" : "rotate(90deg)" }} />
        <span>Extension shapes</span>
        <span className="shape-library-count">{shapes.length}</span>
      </button>
      {open || needle ? (
        <div className="shape-menu-list">
          {shapes.map((def) => (
            <button
              key={`${def.extensionId}:${def.id}`}
              type="button"
              className="shape-menu-item"
              title={def.name}
              aria-label={def.name}
              onClick={() => insertExtensionShapeFromLibrary(def)}
            >
              <span className="shape-menu-thumb extension-shape-thumb" style={{ "--extension-icon-size": "100%" } as CSSProperties}>
                <ExtensionIcon icon={def.icon} size={40} />
              </span>
              <span>{def.name}</span>
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}

// ---- Inspector -----------------------------------------------------------------------------------------------------

function OptionCard({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div className={`property-card extension-card ${open ? "" : "collapsed"}`}>
      <button className="property-card-header" type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span>{title}</span>
        <ChevronUp className={open ? "" : "collapsed"} size={25} strokeWidth={2.8} />
      </button>
      {open ? <div className="property-list">{children}</div> : null}
    </div>
  );
}

/** ShapeInspector: the options of a shape an extension made, and every card an extension adds for this object. */
export function ExtensionShapeOptions({ shape, disabled = false }: { shape: WorkplaneShape; disabled?: boolean }) {
  useExtensionsVersion();
  const [busy, setBusy] = useState(false);
  const made = shapeDefFor(shape);
  const cards = shapeOptionCards(shape);
  const run = useCallback(async (extensionId: string, work: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await work();
    } catch (error) {
      reportExtensionError(extensionId, error);
    } finally {
      setBusy(false);
    }
  }, []);
  if (!made?.def.options?.length && !cards.length) return null;
  return (
    <>
      {made?.def.options?.length ? (
        <OptionCard title={made.def.name}>
          <OptionFields
            options={made.def.options}
            values={made.values}
            disabled={disabled || busy}
            onCommit={(values) => void run(made.def.extensionId, () => rebuildExtensionShape(shape, made.def.extensionId, values))}
          />
        </OptionCard>
      ) : null}
      {cards.map(({ card, options, values }) => (
        <OptionCard key={`${card.extensionId}:${card.id}`} title={card.title}>
          <OptionFields options={options} values={values} disabled={disabled || busy} onCommit={(next) => void run(card.extensionId, () => applyShapeOptionCard(shape, card, next))} />
        </OptionCard>
      ))}
    </>
  );
}

// ---- Settings ------------------------------------------------------------------------------------------------------

export function ExtensionSettingsNavButton({ active, onSelect }: { active: boolean; onSelect: () => void }) {
  useExtensionsVersion();
  if (!installedExtensions().length) return null;
  return (
    <button className={active ? "active" : ""} aria-current={active ? "page" : undefined} onClick={onSelect}>
      <Puzzle size={18} />
      <span>Extensions</span>
    </button>
  );
}

export function ExtensionSettingsSection() {
  useExtensionsVersion();
  const [problem, setProblem] = useState("");
  const [needsReload, setNeedsReload] = useState(false);
  const extensions = installedExtensions();
  const save = (work: Promise<void>) => work.then(() => setProblem("")).catch((error) => setProblem(error instanceof Error ? error.message : String(error)));
  return (
    <div className="extension-settings">
      <div className="workspace-section-heading">
        <p className="workspace-shape-note">
          {extensionStorage() === "server"
            ? "Extensions and their settings are kept in folders of their own on the server, apart from layerling."
            : "Settings are kept in this browser. Set LAYERLING_EXTENSION_DATA_DIR to keep them on the server."}
        </p>
      </div>
      {problem ? <p className="extension-problem" role="alert">{problem}</p> : null}
      {needsReload ? (
        <p className="extension-reload">
          Reload the page to switch extensions on or off. <button type="button" onClick={() => window.location.reload()}>Reload</button>
        </p>
      ) : null}
      {extensions.map((extension) => (
        <section key={extension.id} className="extension-settings-entry">
          <header>
            <label className="extension-field-check">
              <input
                type="checkbox"
                checked={extension.enabled}
                onChange={(event) => {
                  setNeedsReload(true);
                  save(setExtensionEnabled(extension.id, event.currentTarget.checked));
                }}
              />
              <strong>{extension.name}</strong>
            </label>
            <span className="extension-meta">
              {extension.version ? `v${extension.version}` : ""}
              {extension.status === "failed" ? " · failed to load" : extension.status === "disabled" ? " · off" : ""}
            </span>
          </header>
          {extension.description ? <p className="extension-description">{extension.description}</p> : null}
          {extension.error ? <p className="extension-problem">{extension.error}</p> : null}
          {extension.settingsDef?.options.length && extension.status === "active" ? (
            <>
              {extension.settingsDef.title ? <h4>{extension.settingsDef.title}</h4> : null}
              <OptionFields
                options={extension.settingsDef.options}
                values={extensionSettings(extension.id)}
                onCommit={(values) => save(saveExtensionSettings(extension.id, values))}
              />
            </>
          ) : null}
        </section>
      ))}
    </div>
  );
}

// ---- Dashboard project menu ---------------------------------------------------------------------------------------

export function ExtensionProjectMenuItems({ projectId, projectName, onDone }: { projectId: string; projectName: string; onDone: () => void }) {
  useExtensionsVersion();
  const ctx: MenuContext = { ...menuContext("dashboardProject"), projectId, projectName };
  const items = extensionMenuItems("dashboardProject", ctx);
  return (
    <>
      {items.map((item) => (
        <button
          key={`${item.extensionId}:${item.id}`}
          type="button"
          role="menuitem"
          disabled={!menuItemEnabled(item, ctx)}
          onClick={() => {
            onDone();
            runMenuItem(item, ctx);
          }}
        >
          <ExtensionIcon icon={item.icon} size={16} />
          <span>{item.label}</span>
        </button>
      ))}
    </>
  );
}

export type { ExtensionValues };
