const PORT = Number(process.env.COMS_SERVER_PORT) || 5274;

function cors(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Content-Type": "application/json",
  };
}
export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: cors() });
}

async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors() });
  if (req.method === "GET" && url.pathname === "/api/health") return json({ ok: true, port: PORT });
  return json({ ok: false, error: "not found" }, 404);
}

Bun.serve({ port: PORT, hostname: "127.0.0.1", fetch: handle });
console.log("[coms-server] listening on http://127.0.0.1:" + PORT);
