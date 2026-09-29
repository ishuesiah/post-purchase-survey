import { createCookieSessionStorage, redirect } from "react-router";
import { randomBytes, timingSafeEqual } from "node:crypto";

// Google sign-in for the public (non-embedded) dashboard at "/".
// Mirrors the Parcel Scanner (WAYPOST) login: Google OpenID Connect, only
// @hemlockandoak.com accounts, 30-minute inactivity timeout. Uses the same
// Google OAuth client; its redirect-URI list must include
//   <SHOPIFY_APP_URL>/login/google/callback
//
// No OAuth library: the flow is three HTTPS calls, and the id_token comes
// straight from Google's token endpoint over TLS using the client secret,
// so OIDC Core 3.1.3.7 allows skipping signature verification. Claims
// (iss, aud, exp, nonce, email_verified, domain) are still checked.

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);

const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000;
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const SESSION_MAX_AGE_S = 12 * 60 * 60;

export const ALLOWED_EMAIL_DOMAIN = (
  process.env.DASHBOARD_ALLOWED_DOMAIN || "hemlockandoak.com"
).toLowerCase();

function sessionSecret() {
  const secret =
    process.env.DASHBOARD_SESSION_SECRET || process.env.SHOPIFY_API_SECRET;
  if (!secret) {
    throw new Error(
      "Dashboard login needs DASHBOARD_SESSION_SECRET (or SHOPIFY_API_SECRET) to sign its cookie",
    );
  }
  return secret;
}

let storage;
function sessions() {
  storage ??= createCookieSessionStorage({
    cookie: {
      name: "__survey_dashboard",
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: process.env.NODE_ENV === "production",
      secrets: [sessionSecret()],
      maxAge: SESSION_MAX_AGE_S,
    },
  });
  return storage;
}

export function googleConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function appOrigin(request) {
  const configured = process.env.SHOPIFY_APP_URL;
  if (configured) return configured.replace(/\/$/, "");
  // Behind the host's TLS proxy the incoming URL is http; trust the
  // forwarded protocol so the redirect URI matches what Google has on file.
  const url = new URL(request.url);
  const proto = request.headers.get("x-forwarded-proto") || url.protocol.replace(":", "");
  return `${proto}://${url.host}`;
}

export function callbackUrl(request) {
  return `${appOrigin(request)}/login/google/callback`;
}

/** Reads the signed session and returns the user, or null if absent/expired. */
export async function getDashboardUser(request) {
  const session = await sessions().getSession(request.headers.get("Cookie"));
  const user = session.get("user");
  const lastActive = session.get("lastActive") || 0;
  if (!user || Date.now() - lastActive > INACTIVITY_TIMEOUT_MS) return null;
  return user;
}

/**
 * Loader guard for dashboard pages. Redirects to /login when not signed in
 * or idle for 30+ minutes; otherwise returns the user plus a Set-Cookie
 * header that refreshes the activity stamp (callers must forward it).
 */
export async function requireDashboardUser(request) {
  const session = await sessions().getSession(request.headers.get("Cookie"));
  const user = session.get("user");
  const lastActive = session.get("lastActive") || 0;
  if (!user) throw redirect("/login");
  if (Date.now() - lastActive > INACTIVITY_TIMEOUT_MS) {
    throw redirect("/login?reason=expired", {
      headers: { "Set-Cookie": await sessions().destroySession(session) },
    });
  }
  session.set("lastActive", Date.now());
  return {
    user,
    headers: { "Set-Cookie": await sessions().commitSession(session) },
  };
}

/** Step 1: stash state + nonce in the session and send the browser to Google. */
export async function beginGoogleLogin(request) {
  if (!googleConfigured()) throw redirect("/login?error=not_configured");
  const session = await sessions().getSession(request.headers.get("Cookie"));
  const state = randomBytes(24).toString("base64url");
  const nonce = randomBytes(24).toString("base64url");
  session.set("oauth", { state, nonce, at: Date.now() });

  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: callbackUrl(request),
    response_type: "code",
    scope: "openid email profile",
    state,
    nonce,
    prompt: "select_account",
    hd: ALLOWED_EMAIL_DOMAIN, // UI hint only; the domain is enforced below
  });
  throw redirect(`${GOOGLE_AUTH_URL}?${params}`, {
    headers: { "Set-Cookie": await sessions().commitSession(session) },
  });
}

/** Step 2: validate state, exchange the code, check the id_token claims, start a fresh session. */
export async function completeGoogleLogin(request) {
  const url = new URL(request.url);
  const session = await sessions().getSession(request.headers.get("Cookie"));
  const pending = session.get("oauth");
  session.unset("oauth");

  const fail = async (code, detail) => {
    if (detail) console.warn(`[dashboard] Google login rejected (${code}): ${detail}`);
    throw redirect(`/login?error=${code}`, {
      headers: { "Set-Cookie": await sessions().commitSession(session) },
    });
  };

  if (url.searchParams.get("error")) await fail("denied", url.searchParams.get("error"));

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (
    !code ||
    !state ||
    !pending ||
    !safeEqual(state, pending.state) ||
    Date.now() - pending.at > OAUTH_STATE_TTL_MS
  ) {
    await fail("state", "missing, mismatched or stale state");
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: callbackUrl(request),
      grant_type: "authorization_code",
    }),
  });
  if (!tokenResponse.ok) await fail("exchange", `token endpoint ${tokenResponse.status}`);
  const tokens = await tokenResponse.json();

  const claims = decodeJwtClaims(tokens.id_token);
  if (
    !claims ||
    !GOOGLE_ISSUERS.has(claims.iss) ||
    claims.aud !== clientId ||
    !(Number(claims.exp) * 1000 > Date.now()) ||
    !claims.nonce ||
    !safeEqual(claims.nonce, pending.nonce)
  ) {
    await fail("token", "id_token claims failed validation");
  }

  const email = String(claims.email || "").toLowerCase();
  if (claims.email_verified !== true || !email.endsWith(`@${ALLOWED_EMAIL_DOMAIN}`)) {
    await fail("domain", email || "(no email)");
  }

  // Success: brand-new session so nothing pre-login carries over.
  const fresh = await sessions().getSession();
  fresh.set("user", { email, name: claims.name || email, picture: claims.picture || "" });
  fresh.set("lastActive", Date.now());
  console.log(`[dashboard] Google login: ${email}`);
  throw redirect("/", { headers: { "Set-Cookie": await sessions().commitSession(fresh) } });
}

export async function logoutDashboard(request) {
  const session = await sessions().getSession(request.headers.get("Cookie"));
  throw redirect("/login", {
    headers: { "Set-Cookie": await sessions().destroySession(session) },
  });
}

function decodeJwtClaims(jwt) {
  if (typeof jwt !== "string") return null;
  const parts = jwt.split(".");
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}
