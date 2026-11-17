import { promises as fs } from "fs";
import { contentTypeFor, extensionsDir, insideFolder, validExtensionId } from "@/lib/extensions/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The files of an extension: /api/extensions/files/<id>/<path>. Served by path (not a query string) so an
 * extension's modules can import each other with relative paths. Nothing outside the extension's folder.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const root = extensionsDir();
  const { path: parts = [] } = await params;
  const [id, ...rest] = parts.map((part) => decodeURIComponent(part));
  if (!root || !validExtensionId(id) || rest.length === 0 || rest.some((part) => part.startsWith("."))) {
    return new Response("Not found", { status: 404 });
  }
  const folder = insideFolder(root, id);
  const file = folder ? insideFolder(folder, ...rest) : null;
  if (!file) return new Response("Not found", { status: 404 });
  try {
    const stat = await fs.stat(file);
    if (!stat.isFile()) return new Response("Not found", { status: 404 });
    const bytes = await fs.readFile(file);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": contentTypeFor(file),
        // Extensions are edited in place while developing: always ask again, but let the browser revalidate cheaply.
        "Cache-Control": "no-cache",
        "Last-Modified": stat.mtime.toUTCString(),
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
