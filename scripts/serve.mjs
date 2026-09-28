import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
const root = resolve(import.meta.dirname, "..");
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
};
const port = Number(process.env.PORT || 4173);
http
  .createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(
        new URL(req.url, "http://localhost").pathname,
      );
      const path = resolve(root, "." + pathname);
      const relative = path.slice(root.length + 1);
      if (!path.startsWith(root + sep) && path !== root)
        throw new Error("Invalid path");
      if (
        relative.split(/[\\/]/).some((p) => p.startsWith(".")) ||
        /\.(zip|md)$/i.test(path)
      )
        throw new Error("Private file");
      const file = (await stat(path)).isDirectory()
        ? resolve(path, "index.html")
        : path;
      res.writeHead(200, {
        "Content-Type": types[extname(file)] || "application/octet-stream",
        "Cache-Control": "no-cache",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(await readFile(file));
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
  })
  .listen(port, process.env.HOST || "127.0.0.1", () =>
    console.log(`Fox Gallery: http://localhost:${port}`),
  );
