import { NextResponse } from "next/server";
import { originMatchesRequest } from "@/lib/sameOrigin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Passes the Updates window's requests on to the updater container (updater/server.mjs). Without
 * LAYERLING_UPDATER_URL there is no updater: { enabled: false }, and the button stays hidden.
 */
async function forward(path: string, method: "GET" | "POST") {
  const base = process.env.LAYERLING_UPDATER_URL?.trim();
  if (!base) return NextResponse.json({ enabled: false }, { headers: NO_STORE });
  const token = process.env.LAYERLING_UPDATER_TOKEN?.trim();
  try {
    const response = await fetch(new URL(path, base), {
      method,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    return NextResponse.json({ enabled: true, reachable: true, ...body }, { status: response.status, headers: NO_STORE });
  } catch {
    return NextResponse.json({ enabled: true, reachable: false }, { status: 503, headers: NO_STORE });
  }
}

export function GET() {
  return forward("/status", "GET");
}

export async function POST(request: Request) {
  if (!originMatchesRequest(request)) return NextResponse.json({ error: "Refused: another site" }, { status: 403, headers: NO_STORE });
  const body = (await request.json().catch(() => null)) as { action?: unknown } | null;
  if (body?.action === "check") return forward("/check", "POST");
  if (body?.action === "run") return forward("/run", "POST");
  return NextResponse.json({ error: "Expected { action: \"check\" | \"run\" }" }, { status: 400, headers: NO_STORE });
}
