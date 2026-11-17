import { NextResponse } from "next/server";
import { originMatchesRequest } from "@/lib/sameOrigin";
import {
  extensionDataDir,
  listExtensions,
  readExtensionSettings,
  readHostState,
  validExtensionId,
  writeExtensionSettings,
  writeHostState,
} from "@/lib/extensions/server";
import type { ExtensionValues } from "@/lib/extensions/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/** The installed extensions with their stored settings, read fresh on every call. */
export async function GET() {
  const extensions = await listExtensions();
  const settings: Record<string, ExtensionValues> = {};
  for (const extension of extensions) settings[extension.id] = await readExtensionSettings(extension.id);
  return NextResponse.json({ extensions, settings, storage: extensionDataDir() ? "server" : "browser" }, { headers: NO_STORE });
}

/**
 * Saves an extension's settings ({ settings: id, values }) or which extensions are switched off ({ disabled: [...] }).
 * Without LAYERLING_EXTENSION_DATA_DIR there is nowhere to keep them: 501, and the page keeps them in the browser.
 */
export async function PUT(request: Request) {
  if (!originMatchesRequest(request)) return NextResponse.json({ error: "Refused: another site" }, { status: 403, headers: NO_STORE });
  if (!extensionDataDir()) return NextResponse.json({ error: "No extension data folder" }, { status: 501, headers: NO_STORE });
  const body = (await request.json().catch(() => null)) as { settings?: unknown; values?: unknown; disabled?: unknown } | null;
  try {
    if (body && Array.isArray(body.disabled)) {
      await writeHostState(body.disabled.filter(validExtensionId));
      return NextResponse.json(await readHostState(), { headers: NO_STORE });
    }
    if (body && validExtensionId(body.settings) && body.values && typeof body.values === "object") {
      await writeExtensionSettings(body.settings, body.values as ExtensionValues);
      return NextResponse.json({ values: await readExtensionSettings(body.settings) }, { headers: NO_STORE });
    }
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500, headers: NO_STORE });
  }
  return NextResponse.json({ error: "Expected { settings, values } or { disabled }" }, { status: 400, headers: NO_STORE });
}
