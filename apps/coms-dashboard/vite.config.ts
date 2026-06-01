import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ─────────────────────────────────────────────────────────────────────────────
// Auto-discover the coms-net hub the same way the Pi client does:
//   ~/.pi/coms-net/projects/<project>/server.json        -> { local_url, port, ... }
//   ~/.pi/coms-net/projects/<project>/server.secret.json -> { token }
// The browser talks only to Vite (same origin); Vite proxies /v1/* to the hub and
// injects the Bearer token, which solves both CORS and the EventSource header gap.
// Override with env: PI_COMS_NET_PROJECT, PI_COMS_NET_SERVER_URL, PI_COMS_NET_AUTH_TOKEN.
// ─────────────────────────────────────────────────────────────────────────────
function discoverHub(): { target: string; token: string } {
  const project = process.env.PI_COMS_NET_PROJECT ?? "default";
  const dir = join(homedir(), ".pi", "coms-net", "projects", project);

  let target = process.env.PI_COMS_NET_SERVER_URL ?? "";
  if (!target) {
    const serverJson = join(dir, "server.json");
    if (existsSync(serverJson)) {
      try {
        const j = JSON.parse(readFileSync(serverJson, "utf-8"));
        target = j.local_url ?? `http://${j.host ?? "127.0.0.1"}:${j.port}`;
      } catch (e) {
        console.warn(`[coms-dashboard] failed to parse ${serverJson}:`, e);
      }
    }
  }

  let token = process.env.PI_COMS_NET_AUTH_TOKEN ?? "";
  if (!token) {
    const secretJson = join(dir, "server.secret.json");
    if (existsSync(secretJson)) {
      try {
        token = JSON.parse(readFileSync(secretJson, "utf-8")).token ?? "";
      } catch (e) {
        console.warn(`[coms-dashboard] failed to parse ${secretJson}:`, e);
      }
    }
  }

  if (!target) {
    console.warn(
      "[coms-dashboard] no hub found. Start one with `just coms-net-server`, " +
        "or set PI_COMS_NET_SERVER_URL. Proxy will 502 until then.",
    );
    target = "http://127.0.0.1:52965";
  }
  if (!token) {
    console.warn(
      "[coms-dashboard] no auth token found (server.secret.json / PI_COMS_NET_AUTH_TOKEN). " +
        "Requests will 401.",
    );
  } else {
    console.log(`[coms-dashboard] proxying /v1 -> ${target} (token loaded)`);
  }

  return { target, token };
}

const { target, token } = discoverHub();

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5273,
    proxy: {
      "/v1": {
        target,
        changeOrigin: true,
        // Inject the bearer token on every proxied request (REST + SSE).
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        configure(proxy) {
          // Disable response buffering so SSE frames stream through immediately.
          proxy.on("proxyRes", (proxyRes) => {
            if ((proxyRes.headers["content-type"] ?? "").includes("text/event-stream")) {
              delete proxyRes.headers["content-length"];
            }
          });
        },
      },
      "/spawner": {
        target: `http://127.0.0.1:${process.env.PI_SPAWNER_PORT ?? 5274}`,
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/spawner/, ""),
      },
      "/api": {
        target: `http://127.0.0.1:${process.env.COMS_SERVER_PORT ?? 5274}`,
        changeOrigin: true,
        configure(proxy) {
          proxy.on("proxyRes", (proxyRes) => {
            if ((proxyRes.headers["content-type"] ?? "").includes("text/event-stream")) {
              delete proxyRes.headers["content-length"];
            }
          });
        },
      },
    },
  },
});
