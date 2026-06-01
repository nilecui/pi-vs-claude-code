const STATE_TTL = 10 * 60 * 1000;

let _fetch: typeof fetch = (...args: Parameters<typeof fetch>) => fetch(...args);
export function setOidcFetch(f: typeof fetch): void { _fetch = f; }
export function resetOidcFetch(): void { _fetch = (...args: Parameters<typeof fetch>) => fetch(...args); }

function env() {
  return {
    issuer: (process.env.OIDC_ISSUER ?? "").replace(/\/$/, ""),
    clientId: process.env.OIDC_CLIENT_ID ?? "",
    clientSecret: process.env.OIDC_CLIENT_SECRET ?? "",
    redirectUri: process.env.OIDC_REDIRECT_URI ?? "",
  };
}
export function ssoEnabled(): boolean {
  const e = env();
  return !!(e.issuer && e.clientId && e.clientSecret && e.redirectUri);
}

interface Disc { authorization_endpoint: string; token_endpoint: string; userinfo_endpoint: string; }
let _disc: Disc | null = null;
export function __resetDiscovery(): void { _disc = null; }
export async function discover(): Promise<Disc> {
  if (_disc) return _disc;
  const res = await _fetch(`${env().issuer}/.well-known/openid-configuration`);
  if (!res.ok) throw new Error(`discovery ${res.status}`);
  const j = (await res.json()) as Disc;
  _disc = { authorization_endpoint: j.authorization_endpoint, token_endpoint: j.token_endpoint, userinfo_endpoint: j.userinfo_endpoint };
  return _disc;
}
export async function buildAuthUrl(state: string): Promise<string> {
  const d = await discover(); const e = env();
  const p = new URLSearchParams({ response_type: "code", client_id: e.clientId, redirect_uri: e.redirectUri, scope: "openid email profile", state });
  return `${d.authorization_endpoint}?${p.toString()}`;
}
export async function exchangeCode(code: string): Promise<{ access_token: string }> {
  const d = await discover(); const e = env();
  const body = new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: e.redirectUri, client_id: e.clientId, client_secret: e.clientSecret });
  const res = await _fetch(d.token_endpoint, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
  if (!res.ok) throw new Error(`token ${res.status}`);
  return (await res.json()) as { access_token: string };
}
export async function fetchUserInfo(accessToken: string): Promise<{ sub: string; email?: string; preferred_username?: string }> {
  const d = await discover();
  const res = await _fetch(d.userinfo_endpoint, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`userinfo ${res.status}`);
  return (await res.json()) as { sub: string; email?: string; preferred_username?: string };
}

const states = new Map<string, number>();
export function issueState(): string {
  const s = crypto.randomUUID().replace(/-/g, "");
  states.set(s, Date.now() + STATE_TTL);
  return s;
}
export function consumeState(state: string): boolean {
  const exp = states.get(state);
  if (exp === undefined) return false;
  states.delete(state);
  return exp > Date.now();
}
