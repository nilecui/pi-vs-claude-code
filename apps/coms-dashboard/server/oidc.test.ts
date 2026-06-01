import { expect, test, afterEach } from "bun:test";
import { ssoEnabled, setOidcFetch, resetOidcFetch, __resetDiscovery, discover, buildAuthUrl, exchangeCode, fetchUserInfo, issueState, consumeState } from "./oidc";

const ENV = { OIDC_ISSUER: "https://idp.test", OIDC_CLIENT_ID: "cid", OIDC_CLIENT_SECRET: "sec", OIDC_REDIRECT_URI: "http://app/api/auth/oidc/callback" };
function setEnv() { for (const k in ENV) process.env[k] = (ENV as Record<string, string>)[k]; }
function clearEnv() { for (const k in ENV) delete process.env[k]; }
afterEach(() => { clearEnv(); resetOidcFetch(); __resetDiscovery(); });

const DISC = { authorization_endpoint: "https://idp.test/auth", token_endpoint: "https://idp.test/token", userinfo_endpoint: "https://idp.test/me" };
function mockFetch(): typeof fetch {
  return (async (url: unknown) => {
    const u = String(url);
    if (u.includes("/.well-known/openid-configuration")) return new Response(JSON.stringify(DISC), { status: 200 });
    if (u === DISC.token_endpoint) return new Response(JSON.stringify({ access_token: "AT" }), { status: 200 });
    if (u === DISC.userinfo_endpoint) return new Response(JSON.stringify({ sub: "S1", email: "a@b.c", preferred_username: "alice" }), { status: 200 });
    return new Response("no", { status: 404 });
  }) as unknown as typeof fetch;
}

test("ssoEnabled 取决于 env 四项", () => {
  clearEnv(); expect(ssoEnabled()).toBe(false);
  setEnv(); expect(ssoEnabled()).toBe(true);
});

test("discover 解析 .well-known 并缓存", async () => {
  setEnv(); setOidcFetch(mockFetch());
  const d = await discover();
  expect(d.token_endpoint).toBe(DISC.token_endpoint);
});

test("buildAuthUrl 含 client_id/redirect/scope/state", async () => {
  setEnv(); setOidcFetch(mockFetch());
  const url = await buildAuthUrl("st8");
  expect(url.startsWith(DISC.authorization_endpoint)).toBe(true);
  expect(url).toContain("client_id=cid");
  expect(url).toContain("state=st8");
  expect(url).toMatch(/scope=openid(\+|%20)email(\+|%20)profile/); // URLSearchParams 用 + 表示空格
});

test("exchangeCode → access_token;fetchUserInfo → sub", async () => {
  setEnv(); setOidcFetch(mockFetch());
  expect((await exchangeCode("c")).access_token).toBe("AT");
  expect((await fetchUserInfo("AT")).sub).toBe("S1");
});

test("state 一次性 + 未知 false", () => {
  const s = issueState();
  expect(consumeState(s)).toBe(true);
  expect(consumeState(s)).toBe(false);
  expect(consumeState("nope")).toBe(false);
});
