import { redirect } from "react-router";
import { logoutDashboard } from "../lib/dashboard-auth.server";

// POST /logout clears the dashboard session. GET just bounces to /login so
// a stray link can't be used to log someone out cross-site.
export const action = ({ request }) => logoutDashboard(request);
export const loader = () => redirect("/login");
