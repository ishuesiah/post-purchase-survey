import { redirect, useLoaderData } from "react-router";
import {
  ALLOWED_EMAIL_DOMAIN,
  getDashboardUser,
  googleConfigured,
} from "../lib/dashboard-auth.server";
import styles from "../styles/dashboard.module.css";

const ERRORS = {
  not_configured:
    "Google sign-in isn't configured on this server yet. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
  denied: "Google sign-in was cancelled. Try again.",
  state: "That sign-in link expired or didn't match this browser. Try again.",
  exchange: "Google didn't accept the sign-in. Try again.",
  token: "Google returned an invalid sign-in token. Try again.",
  domain: `Access denied. Sign in with an @${ALLOWED_EMAIL_DOMAIN} Google account.`,
};

export const loader = async ({ request }) => {
  if (await getDashboardUser(request)) throw redirect("/");
  const url = new URL(request.url);
  return {
    configured: googleConfigured(),
    error: ERRORS[url.searchParams.get("error")] || "",
    expired: url.searchParams.get("reason") === "expired",
    domain: ALLOWED_EMAIL_DOMAIN,
  };
};

export default function Login() {
  const { configured, error, expired, domain } = useLoaderData();
  return (
    <main className={styles.loginPage}>
      <div className={styles.loginCard}>
        <p className={styles.brand}>Hemlock &amp; Oak</p>
        <h1 className={styles.loginTitle}>Post-purchase survey</h1>
        <p className={styles.muted}>
          Sign in with your @{domain} Google account to see survey responses.
        </p>
        {expired && (
          <p className={styles.notice}>
            Signed out after 30 minutes of inactivity. Sign in again.
          </p>
        )}
        {error && <p className={styles.error}>{error}</p>}
        {configured ? (
          <a className={styles.googleButton} href="/login/google">
            <GoogleMark />
            Sign in with Google
          </a>
        ) : null}
      </div>
    </main>
  );
}

function GoogleMark() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 48 48">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.5l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.3l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z" />
      <path fill="#FBBC05" d="M10.5 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C.9 16.6 0 20.2 0 24s.9 7.4 2.6 10.7l7.9-6.1z" />
      <path fill="#34A853" d="M24 48c6.3 0 11.7-2.1 15.6-5.7l-7.5-5.8c-2.1 1.4-4.8 2.3-8.1 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
    </svg>
  );
}
