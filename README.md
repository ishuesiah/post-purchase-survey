# Hemlock & Oak — Post-Purchase Survey

In-house "How did you first hear about us?" (HDYHAU) survey for hemlockandoak.myshopify.com. A checkout UI extension renders a one-tap survey on the **Thank-you** and **Order status** pages; answers flow to this app's backend, which writes them to **order metafields** (namespace `survey`) and to **Klaviyo profile properties** (`hdyhau_source`, `hdyhau_detail`, `purchase_trigger`).

Built on the Shopify React Router app template (original template docs are kept below).

## How it works

```
Extension (Preact, s-* web components, both pages)
  └─ POST/GET /api/survey  (Bearer session token, CORS)
Backend
  ├─ verify token, shop, payload allow-lists
  ├─ upsert SurveyResponse by orderId → syncStatus=PENDING
  ├─ fire-and-forget syncOrder(): order lookup → metafieldsSet → Klaviyo → SYNCED
  ├─ orders/create webhook: flushes answers saved before the order existed
  └─ 60s interval worker: retries PENDING rows with exponential backoff
```

Key design point: on the Thank-you page **the order does not exist yet** in the Admin API. Answers are stored as `PENDING` rows and flushed by the `orders/create` webhook (fast path) or the worker sweep (backstop). Every step — Prisma upsert, `metafieldsSet`, Klaviyo `profile-import` — is an upsert, so duplicate webhook deliveries and overlapping syncs are harmless.

## Source-of-truth files

| Behavior | File |
| --- | --- |
| Survey UI (both pages) | `extensions/post-purchase-survey/src/Survey.jsx` |
| Admin dashboard (app home): stats, breakdowns, responses table, CSV export | `app/routes/app._index.jsx` |
| Dashboard queries (read-only Prisma read-model) | `app/lib/responses.server.js` |
| Dashboard filter definitions (client-safe, no server imports) | `app/lib/survey-filters.js` |
| Value → label maps for the dashboard/CSV (imports the extension's questions.js) | `app/lib/survey-labels.server.js` |
| Questions/options/copy | `extensions/post-purchase-survey/src/questions.js` |
| Extension → backend calls | `extensions/post-purchase-survey/src/api.js` |
| Extension targets + capabilities | `extensions/post-purchase-survey/shopify.extension.toml` |
| API endpoint (auth, validation, upsert) | `app/routes/api.survey.jsx` |
| Answer allow-lists (must mirror questions.js) | `app/lib/survey-validation.server.js` |
| Order lookup → metafields → Klaviyo → retry | `app/lib/sync.server.js` |
| Klaviyo client | `app/lib/klaviyo.server.js` |
| orders/create webhook (HMAC, dedupe) | `app/routes/webhooks.orders.create.jsx` |
| Retry worker (started from `app/entry.server.jsx`) | `app/lib/worker.server.js` |
| DB models (`SurveyResponse`, `ProcessedWebhook`) | `prisma/schema.prisma` |

## Viewing responses

Open the app in Shopify admin (Apps → post-purchase-survey). The home page is a read-only dashboard over the `SurveyResponse` table:

- **Overview**: responses in the selected period, all-time total, and how many rows are still `PENDING` or `FAILED` to sync.
- **Filters** (period / source / sync status) live in the URL query string, so a filtered view can be bookmarked. The source filter narrows the responses table and Q2 breakdown but is deliberately ignored by the Q1 breakdown so the channel split always shows every source.
- **Breakdown tables** show Q1 by source (with the paid/organic follow-up split per channel) and Q2 by trigger.
- **Responses table**: 25 per page, newest first, each order id links to the order in admin (`shopify:admin/orders/<id>`). Failed rows show the last sync error inline.
- **Export CSV** (page primary action) downloads every response matching the current filters, capped at 10 000 rows. It is a `useFetcher` POST rather than a GET link because a plain link inside the embedded iframe cannot carry the session token. Free-text cells that start with `= + - @` are prefixed with `'` to block spreadsheet formula injection.

The same data also lands on each order as `survey.*` metafields (create definitions under Settings → Custom data → Orders to make them readable there) and on the Klaviyo profile as `hdyhau_source`, `hdyhau_detail`, `purchase_trigger`.

Times on the dashboard are shown in `SHOP_TIMEZONE` (default `America/Vancouver`).

## Environment variables

See `.env.example` for the full annotated list. Secrets (`SHOPIFY_API_SECRET`, `KLAVIYO_PRIVATE_KEY`, `DATABASE_URL`) are never committed; set them in `.env` locally and in the Sevalla dashboard in production.

## Deploy (Sevalla)

1. Sevalla → create a **PostgreSQL** database (same region as the app), connect it to the app so `DATABASE_URL` is injected over the internal network.
2. Create the app from the GitHub repo (`ishuesiah/post-purchase-survey`). Build uses the repo `Dockerfile`; `npm run docker-start` runs `prisma migrate deploy` then starts the server. `PORT` is auto-injected.
3. Set env vars in the Sevalla dashboard: everything in `.env.example` plus `NODE_ENV=production`.
4. Update `application_url` and `[auth] redirect_urls` in `shopify.app.toml` to the Sevalla URL, then from the repo root run `shopify app deploy` (pushes config, webhooks, and the extension). Set `SURVEY_API_URL` in your shell/.env first — it is baked into the extension bundle at build time.
5. Install the app on the store (creates the offline Admin session that `unauthenticated.admin` needs for syncs).
6. **Manual dashboard steps (required, easy to miss):**
   - Partner Dashboard → the extension → request **network access** (extension `fetch` is blocked without it).
   - Shopify admin → Settings → Checkout → Customize → add the app block on **both** the Thank-you page and the Order status page.
7. Optional: create `survey.*` order metafield definitions so answers render nicely in the order admin.

## Gotchas

- **`SURVEY_API_URL` is a build-time constant** in the extension (`process.env.SURVEY_API_URL` in `src/api.js` is substituted by the Shopify CLI). Changing the backend URL requires re-running `shopify app deploy`.
- **Allow-lists are duplicated on purpose**: `app/lib/survey-validation.server.js` must stay in sync with `extensions/post-purchase-survey/src/questions.js`. Bump `SURVEY_VERSION` in both when options change.
- **Slot names are kebab-case in HTML.** `s-choice` follow-ups must use `slot="selected-content"` (not the `selectedContent` spelling from the TypeScript types). A wrong slot name silently drops the content into the label slot, so follow-ups render under *every* option instead of only the selected one.
- The survey card layout (bordered box, `variant="block"` choice lists, inline follow-ups, divider before Q2) mirrors the designer's `mockup.html`; colours come from checkout branding, extensions cannot set CSS.
- **Checkout editor preview always shows the full survey.** When `shopify.extension.editor` is set, the answered flag is ignored and nothing is written to storage or posted to the backend, so clicking around in the editor never locks the preview into the thank-you state or creates rows for the mock order. Reload the editor to reset it.
- The extension **fails silently by design** — network errors never surface on the checkout page. Debug via backend logs, not the storefront.
- `order_id` is client-supplied (session token proves the caller is our extension, not which order they own). Accepted risk for a low-stakes survey; documented in `app/routes/api.survey.jsx`.
- No customer PII is stored: the order email is fetched from the Admin API at sync time and passed straight to Klaviyo. Don't add an email column without revisiting the compliance webhook handlers.
- The worker uses a `globalThis` guard because Vite dev-server reloads re-import modules; without it you get double sweeps in dev.
- Admin API is pinned to `2026-07` (`app/shopify.server.js`), webhooks to `2026-10` (`shopify.app.toml`), extension to `2026-07` (verified 2026-09-28 — re-check before bumping).

---

# Shopify App Template - React Router

This is a template for building a [Shopify app](https://shopify.dev/docs/apps/getting-started) using [React Router](https://reactrouter.com/). It was forked from the [Shopify Remix app template](https://github.com/Shopify/shopify-app-template-remix) and converted to React Router.

Rather than cloning this repo, follow the [Quick Start steps](https://github.com/Shopify/shopify-app-template-react-router#quick-start).

Visit the [`shopify.dev` documentation](https://shopify.dev/docs/api/shopify-app-react-router) for more details on the React Router app package.

## Upgrading from Remix

If you have an existing Remix app that you want to upgrade to React Router, please follow the [upgrade guide](https://github.com/Shopify/shopify-app-template-react-router/wiki/Upgrading-from-Remix). Otherwise, please follow the quick start guide below.

## Quick start

### Prerequisites

Before you begin, you'll need to [download and install the Shopify CLI](https://shopify.dev/docs/apps/tools/cli/getting-started) if you haven't already.

### Setup

```shell
shopify app init --template=https://github.com/Shopify/shopify-app-template-react-router
```

### Local Development

```shell
shopify app dev
```

Press P to open the URL to your app. Once you click install, you can start development.

Local development is powered by [the Shopify CLI](https://shopify.dev/docs/apps/tools/cli). It logs into your account, connects to an app, provides environment variables, updates remote config, creates a tunnel and provides commands to generate extensions.

### Authenticating and querying data

To authenticate and query data you can use the `shopify` const that is exported from `/app/shopify.server.js`:

```js
export async function loader({ request }) {
  const { admin } = await shopify.authenticate.admin(request);

  const response = await admin.graphql(`
    {
      products(first: 25) {
        nodes {
          title
          description
        }
      }
    }`);

  const {
    data: {
      products: { nodes },
    },
  } = await response.json();

  return nodes;
}
```

This template comes pre-configured with examples of:

1. Setting up your Shopify app in [/app/shopify.server.ts](https://github.com/Shopify/shopify-app-template-react-router/blob/main/app/shopify.server.ts)
2. Querying data using Graphql. Please see: [/app/routes/app.\_index.tsx](https://github.com/Shopify/shopify-app-template-react-router/blob/main/app/routes/app._index.tsx).
3. Responding to webhooks. Please see [/app/routes/webhooks.tsx](https://github.com/Shopify/shopify-app-template-react-router/blob/main/app/routes/webhooks.app.uninstalled.tsx).
4. Using metafields, metaobjects, and declarative custom data definitions. Please see [/app/routes/app.\_index.tsx](https://github.com/Shopify/shopify-app-template-react-router/blob/main/app/routes/app._index.tsx) and [shopify.app.toml](https://github.com/Shopify/shopify-app-template-react-router/blob/main/shopify.app.toml).

Please read the [documentation for @shopify/shopify-app-react-router](https://shopify.dev/docs/api/shopify-app-react-router) to see what other API's are available.

## Shopify Dev MCP

This template is configured with the Shopify Dev MCP. This instructs [Cursor](https://cursor.com/), [GitHub Copilot](https://github.com/features/copilot) and [Claude Code](https://claude.com/product/claude-code) and [Google Gemini CLI](https://github.com/google-gemini/gemini-cli) to use the Shopify Dev MCP.

For more information on the Shopify Dev MCP please read [the documentation](https://shopify.dev/docs/apps/build/devmcp).

## Deployment

### Application Storage

This template uses [Prisma](https://www.prisma.io/) to store session data, by default using an [SQLite](https://www.sqlite.org/index.html) database.
The database is defined as a Prisma schema in `prisma/schema.prisma`.

This use of SQLite works in production if your app runs as a single instance.
The database that works best for you depends on the data your app needs and how it is queried.
Here’s a short list of databases providers that provide a free tier to get started:

| Database   | Type             | Hosters                                                                                                                                                                                                                                    |
| ---------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| MySQL      | SQL              | [Digital Ocean](https://www.digitalocean.com/products/managed-databases-mysql), [Planet Scale](https://planetscale.com/), [Amazon Aurora](https://aws.amazon.com/rds/aurora/), [Google Cloud SQL](https://cloud.google.com/sql/docs/mysql) |
| PostgreSQL | SQL              | [Digital Ocean](https://www.digitalocean.com/products/managed-databases-postgresql), [Amazon Aurora](https://aws.amazon.com/rds/aurora/), [Google Cloud SQL](https://cloud.google.com/sql/docs/postgres)                                   |
| Redis      | Key-value        | [Digital Ocean](https://www.digitalocean.com/products/managed-databases-redis), [Amazon MemoryDB](https://aws.amazon.com/memorydb/)                                                                                                        |
| MongoDB    | NoSQL / Document | [Digital Ocean](https://www.digitalocean.com/products/managed-databases-mongodb), [MongoDB Atlas](https://www.mongodb.com/atlas/database)                                                                                                  |

To use one of these, you can use a different [datasource provider](https://www.prisma.io/docs/reference/api-reference/prisma-schema-reference#datasource) in your `schema.prisma` file, or a different [SessionStorage adapter package](https://github.com/Shopify/shopify-api-js/blob/main/packages/shopify-api/docs/guides/session-storage.md).

### Build

Build the app by running the command below with the package manager of your choice:

Using yarn:

```shell
yarn build
```

Using npm:

```shell
npm run build
```

Using pnpm:

```shell
pnpm run build
```

## Hosting

When you're ready to set up your app in production, you can follow [our deployment documentation](https://shopify.dev/docs/apps/launch/deployment) to host it externally. From there, you have a few options:

- [Google Cloud Run](https://shopify.dev/docs/apps/launch/deployment/deploy-to-google-cloud-run): This tutorial is written specifically for this example repo, and is compatible with the extended steps included in the subsequent [**Build your app**](tutorial) in the **Getting started** docs. It is the most detailed tutorial for taking a React Router-based Shopify app and deploying it to production. It includes configuring permissions and secrets, setting up a production database, and even hosting your apps behind a load balancer across multiple regions.
- [Fly.io](https://fly.io/docs/js/shopify/): Leverages the Fly.io CLI to quickly launch Shopify apps to a single machine.
- [Render](https://render.com/docs/deploy-shopify-app): This tutorial guides you through using Docker to deploy and install apps on a Dev store.
- [Manual deployment guide](https://shopify.dev/docs/apps/launch/deployment/deploy-to-hosting-service): This resource provides general guidance on the requirements of deployment including environment variables, secrets, and persistent data.

When you reach the step for [setting up environment variables](https://shopify.dev/docs/apps/deployment/web#set-env-vars), you also need to set the variable `NODE_ENV=production`.

## Gotchas / Troubleshooting

### Database tables don't exist

If you get an error like:

```
The table `main.Session` does not exist in the current database.
```

Create the database for Prisma. Run the `setup` script in `package.json` using `npm`, `yarn` or `pnpm`.

### Navigating/redirecting breaks an embedded app

Embedded apps must maintain the user session, which can be tricky inside an iFrame. To avoid issues:

1. Use `Link` from `react-router` or `@shopify/polaris`. Do not use `<a>`.
2. Use `redirect` returned from `authenticate.admin`. Do not use `redirect` from `react-router`
3. Use `useSubmit` from `react-router`.

This only applies if your app is embedded, which it will be by default.

### Webhooks: shop-specific webhook subscriptions aren't updated

If you are registering webhooks in the `afterAuth` hook, using `shopify.registerWebhooks`, you may find that your subscriptions aren't being updated.

Instead of using the `afterAuth` hook declare app-specific webhooks in the `shopify.app.toml` file. This approach is easier since Shopify will automatically sync changes every time you run `deploy` (e.g: `npm run deploy`). Please read these guides to understand more:

1. [app-specific vs shop-specific webhooks](https://shopify.dev/docs/apps/build/webhooks/subscribe#app-specific-subscriptions)
2. [Create a subscription tutorial](https://shopify.dev/docs/apps/build/webhooks/subscribe/get-started?deliveryMethod=https)

If you do need shop-specific webhooks, keep in mind that the package calls `afterAuth` in 2 scenarios:

- After installing the app
- When an access token expires

During normal development, the app won't need to re-authenticate most of the time, so shop-specific subscriptions aren't updated. To force your app to update the subscriptions, uninstall and reinstall the app. Revisiting the app will call the `afterAuth` hook.

### Webhooks: Admin created webhook failing HMAC validation

Webhooks subscriptions created in the [Shopify admin](https://help.shopify.com/en/manual/orders/notifications/webhooks) will fail HMAC validation. This is because the webhook payload is not signed with your app's secret key.

The recommended solution is to use [app-specific webhooks](https://shopify.dev/docs/apps/build/webhooks/subscribe#app-specific-subscriptions) defined in your toml file instead. Test your webhooks by triggering events manually in the Shopify admin(e.g. Updating the product title to trigger a `PRODUCTS_UPDATE`).

### Webhooks: Admin object undefined on webhook events triggered by the CLI

When you trigger a webhook event using the Shopify CLI, the `admin` object will be `undefined`. This is because the CLI triggers an event with a valid, but non-existent, shop. The `admin` object is only available when the webhook is triggered by a shop that has installed the app. This is expected.

Webhooks triggered by the CLI are intended for initial experimentation testing of your webhook configuration. For more information on how to test your webhooks, see the [Shopify CLI documentation](https://shopify.dev/docs/apps/tools/cli/commands#webhook-trigger).

### Incorrect GraphQL Hints

By default the [graphql.vscode-graphql](https://marketplace.visualstudio.com/items?itemName=GraphQL.vscode-graphql) extension for will assume that GraphQL queries or mutations are for the [Shopify Admin API](https://shopify.dev/docs/api/admin). This is a sensible default, but it may not be true if:

1. You use another Shopify API such as the storefront API.
2. You use a third party GraphQL API.

If so, please update [.graphqlrc.ts](https://github.com/Shopify/shopify-app-template-react-router/blob/main/.graphqlrc.ts).

### Using Defer & await for streaming responses

By default the CLI uses a cloudflare tunnel. Unfortunately cloudflare tunnels wait for the Response stream to finish, then sends one chunk. This will not affect production.

To test [streaming using await](https://reactrouter.com/api/components/Await#await) during local development we recommend [localhost based development](https://shopify.dev/docs/apps/build/cli-for-apps/networking-options#localhost-based-development).

### "nbf" claim timestamp check failed

This is because a JWT token is expired. If you are consistently getting this error, it could be that the clock on your machine is not in sync with the server. To fix this ensure you have enabled "Set time and date automatically" in the "Date and Time" settings on your computer.

### Using MongoDB and Prisma

If you choose to use MongoDB with Prisma, there are some gotchas in Prisma's MongoDB support to be aware of. Please see the [Prisma SessionStorage README](https://www.npmjs.com/package/@shopify/shopify-app-session-storage-prisma#mongodb).

### Unable to require(`C:\...\query_engine-windows.dll.node`).

Unable to require(`C:\...\query_engine-windows.dll.node`).
The Prisma engines do not seem to be compatible with your system.

query_engine-windows.dll.node is not a valid Win32 application.

**Fix:** Set the environment variable:

```shell
PRISMA_CLIENT_ENGINE_TYPE=binary
```

This forces Prisma to use the binary engine mode, which runs the query engine as a separate process and can work via emulation on Windows ARM64.

## Resources

React Router:

- [React Router docs](https://reactrouter.com/home)

Shopify:

- [Intro to Shopify apps](https://shopify.dev/docs/apps/getting-started)
- [Shopify App React Router docs](https://shopify.dev/docs/api/shopify-app-react-router)
- [Shopify CLI](https://shopify.dev/docs/apps/tools/cli)
- [Shopify App Bridge](https://shopify.dev/docs/api/app-bridge-library).
- [Polaris Web Components](https://shopify.dev/docs/api/app-home/polaris-web-components).
- [App extensions](https://shopify.dev/docs/apps/app-extensions/list)
- [Shopify Functions](https://shopify.dev/docs/api/functions)

Internationalization:

- [Internationalizing your app](https://shopify.dev/docs/apps/best-practices/internationalization/getting-started)
