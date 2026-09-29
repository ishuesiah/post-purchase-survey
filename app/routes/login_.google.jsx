import { beginGoogleLogin } from "../lib/dashboard-auth.server";

// GET /login/google: redirects to Google's consent screen.
export const loader = ({ request }) => beginGoogleLogin(request);
