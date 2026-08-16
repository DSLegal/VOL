import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";

const root = resolve("github-pages");
const port = Number(process.env.PORT || 3000);
const configuredBasePath = `/${String(process.env.BASE_PATH || "VOL").replace(/^\/+|\/+$/g, "")}`;

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

if (!existsSync(join(root, "index.html"))) {
  throw new Error("github-pages/index.html is missing. Run the GitHub Pages build first.");
}

createServer((request, response) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
  } catch {
    response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" }).end("Bad request");
    return;
  }
  const effectivePathname = configuredBasePath !== "/" && (pathname === configuredBasePath || pathname.startsWith(`${configuredBasePath}/`))
    ? pathname.slice(configuredBasePath.length) || "/"
    : pathname;
  const relativePath = normalize(effectivePathname).replace(/^([/\\])+/, "");
  let filePath = resolve(root, relativePath || "index.html");

  if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) {
    response.writeHead(403).end("Forbidden");
    return;
  }

  if (existsSync(filePath) && statSync(filePath).isDirectory()) {
    filePath = join(filePath, "index.html");
  }

  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    filePath = join(root, "index.html");
  }

  response.writeHead(200, {
    "Cache-Control": "no-store",
    "Content-Type": contentTypes[extname(filePath).toLowerCase()] ?? "application/octet-stream",
  });
  const stream = createReadStream(filePath);
  stream.on("error", () => {
    if (!response.headersSent) {
      response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    }
    response.end("Unable to read requested file");
  });
  stream.pipe(response);
}).listen(port, "127.0.0.1", () => {
  console.log(`Dashboard running at http://localhost:${port}`);
  console.log("Press Ctrl+C to stop.");
});
