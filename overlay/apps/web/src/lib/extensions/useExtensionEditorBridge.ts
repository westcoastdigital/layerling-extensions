"use client";

import { useEffect, type MutableRefObject } from "react";
import { connectExtensionEditor, extensionEditorChanged } from "@/lib/extensions/host";
import type { ShapeExtensionData } from "@/lib/extensions/types";
import type { LayerlingMcpCommand } from "@/lib/layerlingMcpProtocol";
import { createLocalId } from "@/lib/localIds";
import type { WorkplaneShape } from "@/types/layerling";

type CommitShapes = (next: WorkplaneShape[], nextSelection?: string | string[] | null, message?: string, keyRunKey?: string, amendNewest?: boolean) => void;

/**
 * Hands the open editor to the extensions: the same command runner the MCP server drives, the shapes, the
 * selection, and a way to keep extension data on an object. One call in LayerlingEditor.
 */
export function useExtensionEditorBridge({ executeMcpCommandRef, shapesRef, selectedIdsRef, commitShapes, setNotice, shapes, selectedIds }: {
  executeMcpCommandRef: MutableRefObject<((command: LayerlingMcpCommand) => Promise<unknown>) | null>;
  shapesRef: MutableRefObject<WorkplaneShape[]>;
  selectedIdsRef: MutableRefObject<string[]>;
  commitShapes: CommitShapes;
  setNotice: (message: string) => void;
  shapes: WorkplaneShape[];
  selectedIds: string[];
}) {
  useEffect(() => connectExtensionEditor({
    run: async (action, params) => {
      const execute = executeMcpCommandRef.current;
      if (!execute) throw new Error("The editor is not ready yet");
      return execute({ id: createLocalId("extension-command"), action: action as LayerlingMcpCommand["action"], params, createdAt: Date.now() });
    },
    shapes: () => shapesRef.current,
    selection: () => selectedIdsRef.current,
    setShapeExtensionData: (id, extensionId, data) => {
      let found = false;
      const withData = (shape: WorkplaneShape): WorkplaneShape => {
        if (shape.id !== id) return shape;
        found = true;
        const current = (shape as WorkplaneShape & { extensions?: Record<string, ShapeExtensionData> }).extensions ?? {};
        const { [extensionId]: _old, ...others } = current;
        const extensions = data === undefined ? others : { ...others, [extensionId]: data };
        return { ...shape, extensions: Object.keys(extensions).length ? extensions : undefined } as WorkplaneShape;
      };
      const next = shapesRef.current.map(withData);
      if (!found) throw new Error(`No object with the id ${id}`);
      // Part of the step that made or changed the object, so one undo takes both back.
      commitShapes(next, selectedIdsRef.current, undefined, undefined, true);
    },
    notice: (message) => setNotice(message),
  }), [commitShapes, executeMcpCommandRef, selectedIdsRef, setNotice, shapesRef]);

  useEffect(() => {
    extensionEditorChanged();
  }, [shapes, selectedIds]);
}
