import { completeGoogleLogin } from "../lib/dashboard-auth.server";

// GET /login/google/callback: Google redirects here with ?code&state.
// Register this exact URL on the Google OAuth client.
export const loader = ({ request }) => completeGoogleLogin(request);
