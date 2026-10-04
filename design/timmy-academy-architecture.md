# TimmyTook / Timmy Academy — Architecture Decisions

_Last updated: 2026-10-04_

This document records the current baseline architecture for TimmyTook / Timmy Academy. It is the default starting point for new features unless a later decision explicitly replaces something here.

---

## 1. General architecture principle

For every feature that needs durable user state, progress, settings, history, or other mutable data:

- **The server is the source of truth.**
- `localStorage` / `IndexedDB` are used only for:
  - client-side cache;
  - optimistic UI;
  - offline buffering;
  - easily recoverable UI-only preferences.
- Browser storage must never be the only durable store for valuable user data.
- If Safari/WebKit removes browser storage, the application should simply restore state from the backend.

This applies by default to:

- lesson progress;
- Academy tracker state;
- Location Guesser progress;
- Ammo Recognition Drill progress;
- completed steps;
- submissions metadata;
- saved routes / scenes;
- achievements;
- user settings that need cross-device sync;
- future features with durable state.

Purely local, disposable UI preferences may remain in `localStorage`.

---

## 2. Platform baseline

### Backend

- **Cloudflare Workers**
- **Hono**
- **Cloudflare D1**
- **Drizzle ORM**
- **Zod**
- **Wrangler**
- **Vitest**

### Frontend

- **React**
- **Vite**
- **TanStack Query**
- **Panda CSS**
- **Zod**

React Router can be added when routing complexity justifies it.

---

## 3. State and progress storage

### 3.1 Database

User progress and mutable state live in **Cloudflare D1**.

Prefer normalized, granular rows instead of one large JSON/document blob.

Example principle:

```text
user_id + entity_id + state
```

rather than:

```text
user_id + one giant progress JSON document
```

Reasons:

- easier partial updates;
- safer multi-device merging;
- less write contention;
- simpler indexing;
- better queryability;
- easier migrations.

### 3.2 Indexes

Frequently used D1 queries must have appropriate indexes.

D1 charges based on rows scanned, so avoid accidental full-table scans.

Indexes should be treated as part of the schema design, not as a later optimization.

### 3.3 Client write strategy

The client should update UI immediately and batch writes where appropriate.

Typical flow:

```text
user action
  -> optimistic React state / TanStack Query cache update
  -> queue mutation locally
  -> batch API writes after a short delay
  -> Worker validates session
  -> D1 write
  -> server remains source of truth
```

Do not send twenty independent requests if a short-lived client-side batch can reduce them to a few writes.

---

## 4. Browser storage

Browser storage is a cache, not the primary database.

Allowed uses:

- optimistic cache;
- temporary offline queue;
- transient UI state;
- disposable preferences.

Not allowed as the sole durable storage for:

- lesson completion;
- user progression;
- achievements;
- submissions;
- purchased / credited state;
- anything the user reasonably expects to survive browser cleanup or device changes.

---

## 5. Authentication

### 5.1 Authentication model

Use **passwordless email authentication**.

No Cognito is required.

Preferred login UX:

```text
Continue with email
```

There is no need for separate:

```text
Sign up
Sign in
Forgot password
```

The first successful email verification creates the user account. Later verifications log into the same user.

### 5.2 Login methods

Support both:

- magic link;
- one-time numeric code.

Example:

```text
Sign in to Timmy Academy

482 193

or click:
https://timmy.academy/auth/verify?token=...
```

This allows login even when the email is opened on a different device.

### 5.3 Auth flow

```text
POST /auth/email
```

The backend:

1. normalizes the email;
2. creates a cryptographically secure random challenge token;
3. stores only its hash;
4. gives it a short TTL, approximately 10–15 minutes;
5. sends the email.

Verification can happen through:

```text
GET /auth/verify?token=...
```

or:

```text
POST /auth/verify-code
```

After successful verification:

```text
challenge -> consumed
user      -> find or create
session   -> create
```

### 5.4 Why store only the token hash

The raw magic-link token is sent to the user.

The database stores only:

```text
SHA-256(token)
```

This means a database leak does not directly expose still-valid login links.

The challenge is:

- short-lived;
- single-use;
- deleted or marked consumed after verification.

### 5.5 Sessions

Use **opaque random server-side sessions**, not JWT as the default browser session mechanism.

Cookie:

```text
HttpOnly
Secure
SameSite=Lax
Path=/
long Max-Age
```

JavaScript must not read or rewrite the auth cookie.

The cookie contains only session identity, not user progress or application state.

Suggested tables:

```text
users
auth_challenges
sessions
```

Example shape:

```text
users
-----
id
email
email_verified_at
created_at

auth_challenges
---------------
id
email
token_hash
expires_at
used_at
created_at

sessions
--------
id
user_id
token_hash
expires_at
created_at
last_seen_at
```

### 5.6 Anonymous users

Anonymous users should also have server-backed identity/state.

When a user later verifies an email:

```text
anonymous user
    -> merge ownership/state
authenticated user
```

Progress must not be lost during signup/login.

### 5.7 Auth endpoints

Baseline endpoints:

```text
POST /auth/email
GET  /auth/verify
POST /auth/verify-code
GET  /auth/me
POST /auth/logout
```

### 5.8 Rate limiting

Auth endpoints must be rate-limited.

Initial policy can be roughly:

```text
per IP:    ~5 requests / 15 min
per email: ~3 requests / 15 min
```

Responses should avoid exposing whether an email is already registered.

Example:

```text
If this email can be used, we've sent a sign-in link.
```

---

## 6. Transactional email

Use **Cloudflare Email Service** for authentication emails while it remains suitable for the project.

Primary use:

- magic links;
- one-time login codes;
- future transactional notifications if needed.

This keeps the initial auth stack inside Cloudflare without requiring Cognito or a separate email provider.

If product needs later exceed the service limits or capabilities, the email provider can be replaced without changing the user/session model.

---

## 7. Backend framework

Use **Hono**.

Do not use Fastify as the default backend framework for the Cloudflare Worker runtime.

Reasons:

- native fit for Workers;
- Web Standards-based runtime model;
- minimal framework overhead;
- convenient routing and middleware;
- typed bindings;
- straightforward integration with D1 and Cloudflare services.

Avoid unnecessary enterprise layering.

A reasonable structure:

```text
src/
  index.ts

  auth/
    routes.ts
    service.ts
    repository.ts

  users/
    repository.ts

  progress/
    routes.ts
    service.ts
    repository.ts

  db/
    schema.ts

  shared/
    errors.ts
    validation.ts
    crypto.ts
```

Use layers when they provide value; do not create Controller / Service / Repository / Module boilerplate mechanically for every trivial feature.

---

## 8. Database access

### Decision

Use **Drizzle ORM**.

Do not use raw SQL as the primary application query API.

Do not use TypeORM for this project unless future constraints materially change.

### Reasons

The project requires:

- compile-time schema safety;
- typed query builder;
- explicit SQL-like model;
- low runtime overhead;
- good Cloudflare D1 support;
- predictable migration workflow.

Drizzle keeps the SQL model visible while still providing TypeScript validation.

Example:

```ts
const user = await db
  .select()
  .from(users)
  .where(eq(users.email, email))
  .get()
```

A schema rename or incompatible type change should become a compile-time error wherever possible.

Raw SQL remains acceptable for isolated advanced cases where the query builder is not a good fit.

---

## 9. Database schema source of truth

The **Drizzle TypeScript schema is the source of truth** for database structure.

Example:

```ts
export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
})
```

Schema design should include:

- primary keys;
- unique constraints;
- indexes;
- foreign-key relationships where appropriate.

---

## 10. Migrations

Migration pipeline:

```text
Drizzle TypeScript schema
        |
        v
drizzle-kit generate
        |
        v
generated SQL migration
        |
        v
commit migration to git
        |
        v
Wrangler applies migration
        |
        v
Cloudflare D1
```

### Rules

- Generate migrations with:

```bash
drizzle-kit generate
```

- Commit generated SQL migrations to git.
- Apply migrations through Wrangler:

```bash
wrangler d1 migrations apply
```

- Production database lifecycle should remain under Cloudflare/Wrangler rather than allowing the ORM to mutate production schema implicitly.

Conceptually:

```text
Drizzle Kit = generate
Wrangler     = apply
```

---

## 11. Validation

Use **Zod** for runtime validation.

Typical boundary:

```text
HTTP request
    -> Zod validation
    -> application/service logic
    -> Drizzle
    -> D1
```

Do not rely only on TypeScript types for untrusted runtime input.

### 11.1 Public contracts and private policy

The repository is public. Public schemas define API correctness, not publication trust.
Current submissions pass contract and arithmetic consistency checks, enter pending review,
and become public only after an authorized moderator decision. Those checks do not prove
capture authenticity. No trust score, anomaly detector, quarantine workflow or FPS aggregate
eligibility policy is implemented yet.

Keep these responsibilities public:

- request/response schemas, DTO types, enum values and explicit public field allowlists;
- input ranges, capture arithmetic and documented collector rounding compatibility;
- public read APIs, synthetic fixtures, API collections and contract documentation;
- ordinary idempotency, exact duplicate checks and the generic approve/reject mechanism.

When agreed for implementation, keep these responsibilities in private server code and tests:

- trust scoring and anomaly detection;
- credibility thresholds and publication tolerances beyond contract/rounding correctness;
- abuse, spam and suspicious-duplicate heuristics;
- quarantine and internal moderation decision rules;
- rules deciding which measurements qualify for future aggregates.

Ordinary aggregate calculations and admin UI do not require private source merely because they
run on the backend or are used by moderators. Browser-delivered admin code remains visible to
clients; the server enforces access to data and operations. Private policy must not enter shared
contracts, browser bundles, public documentation, CI logs or public build artifacts. Source
privacy supplements server validation and authorization; it never replaces them.

The current artifact contains the complete compiled Worker, frontend assets, migrations and
deployment metadata. A later private component requires private storage for that artifact and
control of build/test output before it is included. Pin every participating source revision and
record it in artifact metadata. Preserve one build, successful staging, manual production approval,
and promotion of the same verified files without rebuilding.

This records the separation decision only. It creates no private repository, package, service or
deployment path and moves no existing implementation. Already published source remains in Git
history; ordinary validation is not a reason to rewrite that history.

---

## 12. Frontend framework

Use:

```text
React
Vite
TanStack Query
```

Do not base the application on Web Components.

### Why React

The Academy UI is expected to contain increasingly stateful features:

- lesson progress;
- knowledge / skill tree;
- guessers;
- forms;
- authentication state;
- optimistic updates;
- interactive maps;
- media/video workflows;
- training exercises;
- complex stateful controls.

React provides an established application model for this without requiring custom framework infrastructure.

### Web Components

Web Components remain acceptable for genuinely standalone, embeddable widgets.

Example candidates:

```html
<timmy-skill-tree></timmy-skill-tree>
<timmy-location-guesser></timmy-location-guesser>
<timmy-ammo-guesser></timmy-ammo-guesser>
```

But only if we later need these components to be independently embedded outside the main React application.

Rule:

```text
Application UI            -> React
Standalone embed boundary -> Web Component, only if needed
```

---

## 13. Server-state management

Use **TanStack Query** for server state.

Conceptual flow:

```text
D1
 ^
 |
Worker / Hono API
 ^
 |
TanStack Query
 ^
 |
React UI
```

TanStack Query owns:

- fetching;
- caching;
- invalidation;
- refetching;
- mutation state;
- optimistic server-state updates.

Avoid repeating `useEffect + fetch + useState` patterns throughout the application.

---

## 14. Styling system

Use **Panda CSS**.

Do not use Tailwind as the primary styling system.

### Reasons

The project favors compile-time safety and typed contracts.

Panda provides:

- typed CSS properties;
- typed design tokens;
- semantic tokens;
- recipes;
- typed variants;
- build-time CSS generation;
- no runtime CSS-in-JS dependency.

### Design tokens

Create a central token system for at least:

```text
colors
spacing
typography
radii
shadows
breakpoints
```

Prefer semantic tokens over hardcoded visual values.

Example:

```ts
css({
  bg: 'surface.default',
  color: 'text.primary',
  px: '4',
  py: '2',
  borderRadius: 'md',
})
```

Use strict token enforcement where practical.

### Recipes

Use Panda recipes / `cva` for reusable components and components with state variants.

Example:

```ts
const skillNode = cva({
  variants: {
    state: {
      locked: {},
      available: {},
      active: {},
      completed: {},
    },
    difficulty: {
      beginner: {},
      intermediate: {},
      advanced: {},
    },
  },
})
```

Then expose state through component props:

```tsx
<SkillNode
  state="available"
  difficulty="beginner"
/>
```

rather than building large conditional class strings.

### Dynamic values

For values that are genuinely runtime-driven, use CSS variables or inline custom properties where appropriate.

Example:

```tsx
style={{ '--progress': `${progress}%` }}
```

Panda remains responsible for the structural styling and design-system constraints.

---

## 15. Infrastructure configuration

Use **Wrangler** as the main Cloudflare deployment/configuration tool.

Current infrastructure is intentionally simple enough that a separate IaC framework is not required.

Current principle:

```text
Wrangler config in git = sufficient
```

Revisit full IaC when:

- environments multiply;
- DNS management becomes part of the same repository;
- firewall rules become substantial;
- the number of Cloudflare resources grows enough that manual/config-only management becomes awkward.

If a separate IaC layer becomes necessary, the preferred candidate is **Alchemy**, because it is TypeScript-native and fits the rest of the project better than Terraform/OpenTofu/Pulumi.

---

## 16. Cloudflare KV

Use **Cloudflare KV** only where the workload fits KV well:

- read-heavy;
- rarely updated;
- globally useful;
- non-transactional reference data.

Examples may include cached Tarkov reference data or other application-wide lookup data.

Do not use KV as the primary store for mutable user progress.

Rule:

```text
mutable user state -> D1
read-heavy reference/cache -> KV
```

---

## 17. Testing

Use **Vitest** as the default test runner.

Priority test areas:

- auth challenge creation/expiry/consumption;
- session validation;
- anonymous-to-authenticated state merge;
- progress mutations;
- validation failures;
- repository/query behavior;
- migration-sensitive flows.

---

## 18. Current baseline summary

```text
Frontend
--------
React
Vite
TanStack Query
Panda CSS
Zod

Backend
-------
Cloudflare Workers
Hono
Zod

Database
--------
Cloudflare D1
Drizzle ORM
Drizzle Kit
Wrangler migrations

Authentication
--------------
Passwordless email
Magic links + one-time code
Cloudflare Email Service
Opaque HttpOnly server-side sessions

Storage
-------
D1 = source of truth
localStorage / IndexedDB = cache / offline buffer only
KV = read-heavy reference/cache data only

Testing
-------
Vitest
```

---

## 19. Architectural defaults

When implementing a new feature, start from these assumptions unless there is a concrete reason not to:

1. Durable state belongs in D1.
2. Browser state is disposable.
3. Drizzle owns typed schema/query definitions.
4. Wrangler owns D1 migration execution.
5. API endpoints are Hono routes running in Cloudflare Workers.
6. Runtime request data is validated with Zod.
7. React owns application UI.
8. TanStack Query owns server-state synchronization.
9. Panda CSS owns design-system styling.
10. Authentication uses server-side opaque sessions and passwordless email.
11. Anonymous user progress is mergeable into an authenticated account.
12. Prefer simple infrastructure until complexity creates a real need for another layer.
