import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";

const root = resolve(process.argv[2]);
const port = Number(process.argv[3]);
const extensionRoot = process.argv[4] ? resolve(process.argv[4]) : undefined;
const mime = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const relative = normalize(pathname).replace(/^[/\\]+/, "");
    let file = resolve(join(root, relative));
    if (!file.startsWith(`${root}${sep}`) && file !== root) throw new Error("invalid path");
    if (!(await stat(file).catch(() => null))?.isFile()) {
      const extensionAsset =
        extensionRoot && /^(extensions|plugins)[\\/]/.test(relative)
          ? resolve(join(extensionRoot, relative))
          : undefined;
      if (
        extensionAsset?.startsWith(`${extensionRoot}${sep}`) &&
        (await stat(extensionAsset).catch(() => null))?.isFile()
      ) {
        file = extensionAsset;
      } else {
        file = join(root, "index.html");
      }
    }
    response.writeHead(200, { "Content-Type": mime[extname(file)] ?? "application/octet-stream" });
    createReadStream(file).pipe(response);
  } catch (error) {
    response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(String(error));
  }
}).listen(port, "127.0.0.1", () => process.stdout.write(`ready=${port}\n`));
