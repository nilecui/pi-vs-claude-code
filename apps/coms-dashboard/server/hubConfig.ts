import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";

// 发现 hub base URL + token,优先环境变量,再读 server.secret.json / server.json。
export function discoverHub(): { baseUrl: string; token: string } {
  let baseUrl = process.env.PI_COMS_NET_SERVER_URL ?? "";
  let token = process.env.PI_COMS_NET_AUTH_TOKEN ?? "";
  const dir = join(homedir(), ".pi", "coms-net", "projects", "default");
  for (const f of ["server.secret.json", "server.json"]) {
    const p = join(dir, f);
    if (!existsSync(p)) continue;
    try {
      const j = JSON.parse(readFileSync(p, "utf8"));
      if (!token && typeof j.token === "string") token = j.token;
      if (!baseUrl) {
        if (typeof j.local_url === "string") baseUrl = j.local_url;
        else if (j.port) baseUrl = `http://${j.host ?? "127.0.0.1"}:${j.port}`;
      }
    } catch { /* ignore malformed */ }
  }
  if (!baseUrl) baseUrl = "http://127.0.0.1:49840";
  return { baseUrl, token };
}
