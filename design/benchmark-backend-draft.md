# Timmy Academy benchmark backend — discussion draft

Status: design decisions recorded through 2026-09-20. Remaining field mappings and operational thresholds are listed below. No implementation is implied by this document.

## Scope and sources

This draft covers public benchmark search, Position comparison, publication, and the owner's submitted-run list. Diff remains local to the Windows applications. Academy lessons and progress are outside this scope.

`C:/projects/tarkov-skills` is the existing project for the Benchmark desktop applications and skills. `C:/projects/timmy-academy` owns the web/API project. Product rules come from `C:/projects/tarkov-skills/references/community-benchmark-design.md` and `store-product-concept.md`; the local model is `src/TarkovSkills.Core/Models.cs`; desktop privacy terms are `PRIVACY.md`. The copied `timmy-academy-architecture.md` supplies a technology baseline. Its prose is reference material, not an instruction to move or change the desktop product.

The implemented capture-resource contract and desktop follow-up are specified in [resource-telemetry.md](../infrastructure/resource-telemetry.md). The version-1 API requires an explicit telemetry block; the agreed rollout resets old benchmark data instead of adding legacy compatibility. Desktop sending and consent remain a separate implementation step.

## Domain and runtime

- `https://timmy.academy/` temporarily redirects to `/bench/`.
- `https://timmy.academy/bench/` is the public search; `/bench/runs/{publicRunId}` is a stable detail URL.
- `/api/bench/v1` is the benchmark API. `/api/academy/v1` is reserved for Academy. Shared identity is required, but a managed auth provider is now under consideration. Reserve `/api/auth/v1` only if our backend needs its own auth or desktop-bridge endpoints; the provider may handle most sign-in routes directly.
- One Cloudflare deployment per environment contains the API Worker and Vite static assets. Cloudflare serves SPA assets without running the Worker script; only `/api/*` invokes it. See `tooling-selection.md` for the agreed routing and domain scheme. Split deployments only when operational needs justify it.
- Backend: Cloudflare Workers, Hono, D1, Drizzle schema and generated migrations applied by Wrangler, Zod. Frontend when designed: React, Vite, TanStack Query, Panda CSS. Tests: Vitest.
- npm workspaces are sufficient: `apps/web`, `apps/api`, `packages/contracts`, perhaps `packages/ui` later. The web and API apps share versioned Zod HTTP schemas and inferred TypeScript types through `contracts`, built before its consumers. The C# desktop apps remain in their existing repository and use a versioned OpenAPI description of `/api/bench/v1`; they explicitly map local run data to the sanitized publication DTO. Deployment and environment configuration live in `infrastructure/`, with separate test/staging and production environments. See `tooling-selection.md` for the agreed package boundaries; no physical database schema is implied.

## Proposed endpoints

| Method and path                                        | Access           | Purpose                                                                                                                                                                                                                         |
| ------------------------------------------------------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/bench/v1/runs`                               | anonymous        | Filtered, cursor-paginated public run search. The browse view groups runs by CPU, GPU and RAM capacity; each displayed FPS belongs to one run.                                                                                                                                              |
| `GET /api/bench/v1/runs/{publicRunId}`                 | anonymous        | One published run, public allowlist only; 404 after removal.                                                                                                                                                                    |
| `POST /api/bench/v1/cohorts/query`                     | anonymous        | Position request using a local run's selected comparison conditions; returns exact criteria, counts and individual examples. POST avoids long URLs and browser history containing query details. It never publishes the run. |
| `POST /api/bench/v1/me/runs`                           | verified account | Publish one explicitly selected run, with `client_run_id` as the idempotency key.                                                                                                                                               |
| `GET /api/bench/v1/me/runs`                            | owner            | List own submitted runs and publication/moderation state.                                                                                                                                                                       |
| `GET /api/bench/v1/me/runs/by-client-id/{clientRunId}` | owner            | Recover an acknowledgement after timeout, including pending state.                                                                                                                                                              |
| `DELETE /api/bench/v1/me/runs/{publicRunId}`            | owner            | Delete an owned publication; remove it from public reads and comparisons, with a separately anonymized measurement eligible for internal skill use. Repeated requests must not republish it.                                    |

Naming: use plural `runs` for resources. `search` need not be a separate endpoint from filtered `GET /runs`. Keep the cohort query separate because it uses the selected local run's comparison conditions, not ordinary search pagination. `POST /cohorts/query` is a read operation and must have no publication side effect.

## HTTP contract conventions

All paths below are relative to `/api/bench/v1`. JSON property names use `snake_case`, except the explicitly allowlisted saved-game keys inside `settings_snapshot`; timestamps are UTC ISO 8601 and `captured_day` is `YYYY-MM-DD`. `null` means unknown or unavailable and is never silently replaced with a Windows display value. Examples use fictional measurements and opaque IDs. `game_resolution` means the selected **in-game screen resolution** from the confirmed `Graphics.ini` mapping; it does not claim a measured swap-chain, internal render size or physical monitor mode. Unknown request fields and unsupported enum values return `422 invalid_input`; private fields are never echoed in errors. Anonymous responses use only the projections defined here. The server selects those fields explicitly, not by serializing its publication record.

The initial public hardware tuple is normalized CPU model ID, normalized GPU model ID and normalized installed RAM capacity in GB. Equality of all three values defines a **navigation group**, not an aggregate measurement or a run. The normalization rules and IDs are server-owned. Additional RAM module models, GPU variants/version details and SSD information are neither grouping keys nor separate filters; their planned collection in the Windows Benchmark does not make them required public fields. One `public_run_id` identifies exactly one capture and is the only target of `Details`.

### `GET /filter-options` — observed public filter values

Public UI implementation decision (2026-09-22): a small anonymous read-only endpoint supplies selectable values from the same public dataset as search. It accepts no query parameters and returns `{ cpus, gpus, ram_gb, maps, game_resolutions, game_versions }`. CPU/GPU/maps contain distinct `{ id, name }` public model projections; capacities are positive integer GB values, resolutions are distinct `{ width, height }` pairs, and versions are exact build strings. Unknown resolutions and versions are omitted. Empty datasets return empty arrays. Named values are ordered by name then ID, capacities and resolutions numerically, and versions lexically (not by inferred compatibility).

This is an observed-values list, not a complete hardware/map catalog or a production normalization rule. It is independent of active filters, so selecting one value does not hide options for other fields. The web does not import the server fixture catalog or infer missing IDs from names. The response exposes no ownership fields, counts or raw settings, uses the shared strict `filterOptionsSchema`, and inherits `Cache-Control: no-store`. A future persistent repository must derive these values from publicly visible runs only, removing values when their last public run disappears. The initial response is unpaginated; large catalogs will require a bounded searchable contract before rollout at that scale.

### `GET /runs` — public search

| Query parameter | Contract |
| --- | --- |
| `view` | `groups` (default) or `items`. `groups` pages hardware cards; `items` pages individual runs within one card. |
| `group_key` | Required only for `view=items`; forbidden for `view=groups`. An opaque navigation token returned on a group, bound to its normalized hardware tuple, search filters, sort and snapshot. It is not a stable public ID or a detail URL. |
| `cpu`, `gpu` | Exact server-normalized model IDs. No substring or fuzzy match in v1. |
| `ram_gb` | Exact normalized installed-RAM capacity in GB, a positive integer. |
| `map` | Exact canonical map ID. |
| `execution` | `bsg_servers` or `local`. |
| `game_width`, `game_height` | Positive integer selected in-game screen-resolution dimensions from the verified `DisplaySettings.Resolution` mapping; supply both or neither. Windows desktop resolution is not a substitute. |
| `game_version` | Exact game build string; no compatibility expansion in v1. |
| `sort` | `captured_desc` (default) or `captured_asc`. There is no relevance, normalized-FPS or ranking sort. |
| `limit` | Number of groups for `view=groups` or runs for `view=items`; default 20, maximum 50. |
| `cursor` | Opaque continuation token from the same view, group, filters, sort, limit and result snapshot. Omit on the first page. |

Any subset of the four main filters (`cpu`, `gpu`, `ram_gb`, `map`), including none, returns results immediately. All supplied filters apply with AND semantics. A run whose value is unknown cannot satisfy a filter on that field, but remains visible when the field is not filtered. Unapproved graphics, render-scale and upscaling keys are not accepted as filters yet; add named, typed filters to this versioned contract only after their collection and semantics are verified. Do not accept arbitrary `settings.*` query keys.

`groups` are ordered by the first matching run in each group under `sort`; ties use the group key. Within a group, runs are ordered by captured day, then server publication time, then public run ID in the requested direction. The preview contains at most one run per map and at most three maps, chosen from that run order. Thus each preview FPS is an individual run, including when multiple runs exist on the same map. `run_count`, `map_count`, `contributor_count` and `remaining_run_count` describe the filtered snapshot; no FPS is averaged. `items` returns all matching runs in its group using the same sort and filters. The `group_key` from a card is how the client gets runs omitted from its preview.

The first page establishes a search snapshot. Subsequent cursors exclude later publications and keep group membership, counts and ordering fixed while the snapshot is valid. A cursor binds its exact normalized filters, view, group key, sort and limit; changing any of them returns `400 invalid_cursor` and the client starts a new first page. If deletion/moderation or expiry makes a snapshot unsafe to continue without skipped or repeated visible runs, return `409 cursor_stale`; restart from page one. A `group_key` used with changed filters/sort or an unavailable snapshot returns `409 group_key_stale`. Removed runs never remain publicly readable merely because a cursor was issued earlier. No offset pagination is offered.

Example: a partial search, with one card containing four individual runs across two maps:

```http
GET /api/bench/v1/runs?gpu=geforce-rtx-4070-super&view=groups&sort=captured_desc&limit=20
```

```json
{
  "view": "groups",
  "filters": {"cpu": null, "gpu": "geforce-rtx-4070-super", "ram_gb": null, "map": null, "execution": null, "game_width": null, "game_height": null, "game_version": null},
  "sort": "captured_desc",
  "limit": 20,
  "summary": {"group_count": 1, "run_count": 4, "contributor_count": 2},
  "groups": [{
    "group_key": "hg_L7q8",
    "hardware": {"cpu": {"id": "ryzen-7-7800x3d", "name": "Ryzen 7 7800X3D"}, "gpu": {"id": "geforce-rtx-4070-super", "name": "GeForce RTX 4070 SUPER"}, "ram_gb": 32},
    "run_count": 4,
    "map_count": 2,
    "contributor_count": 2,
    "preview_runs": [
      {"public_run_id": "br_8N4qP2vK", "url": "/bench/runs/br_8N4qP2vK", "captured_day": "2026-09-16", "map": {"id": "lighthouse", "name": "Lighthouse"}, "execution": "bsg_servers", "game_resolution": {"width": 2560, "height": 1440}, "game_version": "0.16.9.0", "metrics": {"average_fps": 121.0, "one_percent_low_fps": 82.0}},
      {"public_run_id": "br_3tQ7mW5a", "url": "/bench/runs/br_3tQ7mW5a", "captured_day": "2026-09-15", "map": {"id": "customs", "name": "Customs"}, "execution": "local", "game_resolution": {"width": 1920, "height": 1080}, "game_version": "0.16.9.0", "metrics": {"average_fps": 118.0, "one_percent_low_fps": 79.0}}
    ],
    "remaining_run_count": 2
  }],
  "next_cursor": null
}
```

The group may have three Lighthouse runs, but its preview still shows only one Lighthouse measurement. To retrieve all four, including those not previewed, repeat the **same filters and sort** with the returned group key:

```http
GET /api/bench/v1/runs?gpu=geforce-rtx-4070-super&view=items&group_key=hg_L7q8&sort=captured_desc&limit=2
```

```json
{
  "view": "items",
  "group_key": "hg_L7q8",
  "filters": {"cpu": null, "gpu": "geforce-rtx-4070-super", "ram_gb": null, "map": null, "execution": null, "game_width": null, "game_height": null, "game_version": null},
  "sort": "captured_desc",
  "limit": 2,
  "group": {"hardware": {"cpu": {"id": "ryzen-7-7800x3d", "name": "Ryzen 7 7800X3D"}, "gpu": {"id": "geforce-rtx-4070-super", "name": "GeForce RTX 4070 SUPER"}, "ram_gb": 32}, "run_count": 4, "map_count": 2, "contributor_count": 2},
  "items": [
    {"public_run_id": "br_8N4qP2vK", "url": "/bench/runs/br_8N4qP2vK", "captured_day": "2026-09-16", "map": {"id": "lighthouse", "name": "Lighthouse"}, "execution": "bsg_servers", "game_resolution": {"width": 2560, "height": 1440}, "game_version": "0.16.9.0", "metrics": {"average_fps": 121.0, "one_percent_low_fps": 82.0}},
    {"public_run_id": "br_3tQ7mW5a", "url": "/bench/runs/br_3tQ7mW5a", "captured_day": "2026-09-15", "map": {"id": "customs", "name": "Customs"}, "execution": "local", "game_resolution": {"width": 1920, "height": 1080}, "game_version": "0.16.9.0", "metrics": {"average_fps": 118.0, "one_percent_low_fps": 79.0}}
  ],
  "next_cursor": "cur_K4p2"
}
```

The next request keeps every query parameter above and adds `cursor=cur_K4p2`:

```http
GET /api/bench/v1/runs?gpu=geforce-rtx-4070-super&view=items&group_key=hg_L7q8&sort=captured_desc&limit=2&cursor=cur_K4p2
```

```json
{"view":"items","group_key":"hg_L7q8","filters":{"cpu":null,"gpu":"geforce-rtx-4070-super","ram_gb":null,"map":null,"execution":null,"game_width":null,"game_height":null,"game_version":null},"sort":"captured_desc","limit":2,"group":{"hardware":{"cpu":{"id":"ryzen-7-7800x3d","name":"Ryzen 7 7800X3D"},"gpu":{"id":"geforce-rtx-4070-super","name":"GeForce RTX 4070 SUPER"},"ram_gb":32},"run_count":4,"map_count":2,"contributor_count":2},"items":[{"public_run_id":"br_6pD2sJ9n","url":"/bench/runs/br_6pD2sJ9n","captured_day":"2026-09-14","map":{"id":"lighthouse","name":"Lighthouse"},"execution":"bsg_servers","game_resolution":{"width":2560,"height":1440},"game_version":"0.16.9.0","metrics":{"average_fps":117.0,"one_percent_low_fps":78.0}},{"public_run_id":"br_5vR8hC1x","url":"/bench/runs/br_5vR8hC1x","captured_day":"2026-09-13","map":{"id":"lighthouse","name":"Lighthouse"},"execution":"bsg_servers","game_resolution":{"width":2560,"height":1440},"game_version":"0.16.9.0","metrics":{"average_fps":115.0,"one_percent_low_fps":76.0}}],"next_cursor":null}
```

With no matching runs, `GET /runs?map=lighthouse&cpu=ryzen-7-7800x3d&gpu=geforce-rtx-4070-super&ram_gb=32` returns `200` without substituting nearby hardware or maps:

```json
{"view":"groups","filters":{"cpu":"ryzen-7-7800x3d","gpu":"geforce-rtx-4070-super","ram_gb":32,"map":"lighthouse","execution":null,"game_width":null,"game_height":null,"game_version":null},"sort":"captured_desc","limit":20,"summary":{"group_count":0,"run_count":0,"contributor_count":0},"groups":[],"next_cursor":null}
```

### `GET /runs/{publicRunId}` — one public run

The response is a single capture, not its hardware group. `game_resolution`, `game_version`, `render_scale`, `upscaling` and `settings` may be `null`; unknown values remain visible as unknown. `settings` contains only the approved public projection in [benchmark-settings-allowlist.md](benchmark-settings-allowlist.md), never the private selected-key snapshot. `author` is `null` or `{ "display_name": string, "avatar_url": string | null }` from an optional public profile. The avatar is not inferred from email. Required `resource_telemetry` contains capture-window summaries, including logical processors and anonymous pagefiles. The following detail excerpt omits that block for space; its exact fields are in [the resource contract](../infrastructure/resource-telemetry.md#wire-contract).

```http
GET /api/bench/v1/runs/br_8N4qP2vK
```

```json
{
  "public_run_id": "br_8N4qP2vK",
  "url": "/bench/runs/br_8N4qP2vK",
  "captured_day": "2026-09-16",
  "hardware": {"cpu": {"id": "ryzen-7-7800x3d", "name": "Ryzen 7 7800X3D"}, "gpu": {"id": "geforce-rtx-4070-super", "name": "GeForce RTX 4070 SUPER"}, "ram_gb": 32, "tuning_class": "unknown"},
  "conditions": {"map": {"id": "lighthouse", "name": "Lighthouse"}, "execution": "bsg_servers", "game_resolution": {"width": 2560, "height": 1440}, "game_version": "0.16.9.0", "render_scale": null, "upscaling": null, "weather": "unknown", "time_of_day": "day"},
  "capture": {"duration_sec": 118.7, "sample_count": 14363},
  "metrics": {"average_fps": 121.0, "one_percent_low_fps": 82.0, "zero_point_one_percent_low_fps": 54.0, "average_frametime_ms": 8.26, "p95_frametime_ms": 11.8, "p99_frametime_ms": 16.4},
  "settings": {"game": {"automatic_ram_cleaner": false, "only_use_physical_cores": true}, "graphics": {"screen_mode": "borderless", "texture_quality_code": 2, "shadows_quality_code": 0, "anti_aliasing": "TAA_High", "dlss_mode": "Off", "fsr2_mode": "Off", "fsr3_mode": "Off", "vsync": false, "high_quality_color": false}, "postfx": {"enabled": false}},
  "quality_notes": [],
  "author": null
}
```

The example's PostFX state is the saved `EnablePostFx: false`, not the screenshot's temporary On state. Fields absent from the selected-key snapshot remain omitted; if no approved public settings are present, `settings` is `null`. `quality_notes` is an approved enum-code list, never free-text local warnings. A removed, unpublished or unknown ID returns `404 not_found` with the standard error shape.

The anonymous allowlist is deliberately smaller than the publication DTO: search and Position run summaries contain only `public_run_id`, `url`, `captured_day`, map ID/name, execution, selected game screen resolution, game version, Average FPS and 1% low; a browse group additionally contains its normalized CPU/GPU ID/name, RAM GB and counts. Detail additionally contains the same hardware tuple, optional tuning class, bounded context, capture duration/sample count, 0.1% low and frametime metrics, individually approved settings, quality-note codes and optional public author name/avatar. Search and Position contain contributor **counts** but never contributor identifiers. No anonymous response contains email, private account or client run ID, local paths, raw hardware/machine IDs, private selected-key settings snapshot, raw capture, session data or moderation notes. Additional RAM module models, GPU version details and SSD information are absent from this v1 allowlist.

### Benchmark screen data needs

| Screen | Data source and request | User actions and navigation |
| --- | --- | --- |
| Search and browse | URL holds filters; `GET /api/bench/v1/runs` provides grouped cards, individual preview runs, counts and cursors. `GET /filter-options` supplies the distinct values observed in public runs. `view=items` reveals the remaining runs in one hardware group. | Select or clear filters with immediate results; expand a group; open the selected run's public details. |
| Public run details | `GET /api/bench/v1/runs/{publicRunId}` provides the one published run and approved details. | Copy the stable link or return to the last browse URL; direct visits need no sign-in. |
| My Bench | Authenticated `GET /api/bench/v1/me/runs` provides only that account's server-submitted runs and publication/review states. | Open a published public run or confirm `DELETE /api/bench/v1/me/runs/{publicRunId}`. Pending review is not public. Complete local history stays in the Windows app. |
| Email sign-in and code | The eventual auth provider handles challenge/session data; no benchmark endpoint is added for these steps. | Return to My Bench after sign-in if that was the destination; `BENCH` and back navigation restore the last browse URL. |

Wireframe settings-profile and hardware-target concept pages remain outside the initial website scope and create no endpoints. Publishing is initiated only in the Windows Benchmark app.

Auth provider selection is open; see `auth-provider-comparison.md`. The agreed auth boundary and browser-based Windows flow are in `auth-boundary.md`. Anonymous benchmark reads need no durable anonymous account. The Worker maps a verified provider identity to a stable private application account before owner operations. Product code remains independent of the provider.

## Web UX discussion notes

Status: `design/wireframes/benchmark-user-paths.drawio` is the current approved wireframe baseline for further discussion. It is not a final visual design or UI implementation. The Academy-wide header remains a placeholder; pages 09–10 are exploratory and outside the initial website scope.

- All user-facing Timmy Academy interface text is in English. The initial benchmark site focuses on browsing published measurements and inspecting each public run. Deciding which settings to try belongs to the Tarkov skill, not this site; website hardware-purchase guidance is outside the current scope. The settings and hardware concept pages in `design/wireframes/benchmark-user-paths.drawio` are kept at the end as exploratory references, without navigation from the initial public search. Any later guidance must show observed FPS and comparison conditions, not a promised FPS or universal normalized score.
- The Academy-wide header is provisional. For the benchmark wireframes, show a `BENCH` link and a profile icon, without a separate `Search` or `My Bench` header link. `BENCH` returns to the last visited benchmark browse URL when one is known; search criteria are represented in that URL, so coming back from a run detail, sign-in or owner page restores the filters rather than clearing them. With no previous browse URL, open the unfiltered page. The guest profile menu leads to email-code sign-in; the signed-in profile menu offers `My Bench` and `Sign out`. A successful sign-in initiated for `My Bench` returns there. The exact Academy shell and route-state implementation remain open.
- The core public task is finding results for a CPU, GPU, RAM capacity and map. Keep those in one prominent search flow; resolution, BSG servers versus Local and game version are relevant comparison conditions. Avoid a second `Apply filters` action detached from the main search.
- Do not use unexplained `High quality`/`Good sample` badges, `Most relevant` sorting, or a website `Submit result` action. Submission is initiated only in the Microsoft Store Benchmark app. Expose concrete capture facts or warnings when useful.
- The API's atomic result remains one published run: one capture, map, settings/context and metrics. The browse view groups runs under cards headed by CPU, GPU and RAM capacity, with a short preview of at most three map rows and a way to reveal the remaining maps/runs. If several runs exist on one map, label the shown FPS as one actual run and show that more runs exist; never silently average runs with differing conditions. The row focuses on map, BSG/Local mode, game resolution, game version, Average FPS and 1% low. Do not put a generic `Settings` summary column in the compact list: the reviewed settings belong in run details and optional filters. A grouped card must not imply that several maps were measured in one run or that differing conditions are identical.
- A signed-in `My Bench` page lists the account's server-submitted runs and their publication/moderation states. Each published run has a trash button beside it. The confirmation dialog explains that deletion removes the publication from public search and comparisons while the local capture in the Benchmark app remains; use explicit `Yes, delete publication` / `No, keep it` choices. Anonymized measurement retention is disclosed before publication and in the privacy policy, not repeated in this short dialog. No ordinary edit action is offered. Distinguish these submitted runs from complete local history, which remains in the Windows app and is never uploaded automatically. The exact page label and layout remain open.
- `Details` on a public search row opens that row's public run detail page; it is anonymous and does not require sign-in. `Open` in `My Bench` can lead to the same public page for a published run. Each detail page describes one run, not a user's private local capture. Capture telemetry measures whole-system physical RAM and selected-adapter GPU usage over this capture, including other applications; it does not measure per-game memory. Do not show uncollected `MIN FPS`, full frametime trace, fixed route, free-text tester notes or other fields absent from the approved public contract.

## Public run contract

Use a server-generated random opaque ID, independent of the local UUID and account ID. Store the local UUID privately only for owner idempotency. Never derive the public URL from an email, nickname, hardware string or timestamp.

The publication request is a new versioned, validated DTO, not `BenchmarkRun` serialized wholesale. It includes: schema version, private client run ID for idempotency, captured day, app version, known map ID, BSG/Local execution, game version, selected in-game screen width/height when available from the verified saved-settings mapping, sanitized CPU/GPU display names and normalized RAM capacity, optional self-reported tuning class, a private **selected-key** settings snapshot under the [v1 allowlist](benchmark-settings-allowlist.md), bounded weather/time context, actual capture duration, sample count, performance metrics and the strict capture-resource summary. Render scale and upscaling are recorded as approved graphics settings; a separate derived field can be added only after its semantics are reviewed. The server derives normalized CPU/GPU search keys. Unknown values stay explicitly unknown. Public search and detail responses select their own smaller allowlists from accepted data.

The settings catalog is now proposed as `settings_snapshot.schema_version: 1` with exact accepted paths, types, values and public visibility. The server must independently reject unknown sections/keys, extra properties, malformed values, excessive size or depth, and free text that has not been reviewed; client-side sanitization is not sufficient against malicious requests. The current model stores `system`, `settings` and `context` as `object`, so none may be accepted or returned wholesale. In the inspected current code, `system.gpu[].current_resolution` comes from `Win32_VideoController` and must not populate `game_resolution`. Controlled game-UI changes confirmed `graphics.DisplaySettings.Resolution.Width/Height` as the selected game screen resolution across Borderless, Windowed and Fullscreen. The server cross-checks the top-level `game_resolution` against this accepted settings pair whenever both are supplied; a mismatch is invalid input. Exclude raw CSV, paths, host/user names, IPs, serials, machine IDs, pagefile paths and unreviewed settings keys from publication.

Public detail responses contain only the approved display fields. Captured date has day precision. Search/cohort responses use an even smaller projection. Optional author display name and avatar come from an explicitly public profile, never from the verified email or an implicit email-derived avatar. If the profile has no author information, omit it. The public author is never an ownership key. No email, account ID, client run ID, session data, moderation notes or unreviewed internal source strings appear in any anonymous response. Reviewed telemetry source/scope literals are public.

## Exact comparison policy

1. A comparison uses exact canonical CPU, GPU and installed RAM capacity class, exact map, BSG versus Local, known selected in-game screen resolution and exact game build. It does not widen to another hardware model, RAM class, resolution, execution mode, map or version when no matches exist. Runs with unknown version or game resolution remain searchable and visible in detail but cannot satisfy those specified comparison conditions.
2. Approved graphics settings, render scale, upscaling and tuning class can be visible and later become named optional search filters after their field semantics are verified. They are not default equality requirements. Label known material differences between displayed runs. A stock-versus-tuned claim requires a separately reviewed rule; unknown tuning does not mean stock.
3. Every match is an individual published run. Return its real Average FPS and other approved metrics, plus counts of distinct contributors and matching runs. A prolific contributor's runs remain individually visible; these counts must not be presented as independent contributors. There is no widened match tier, aggregate FPS score, percentile, rank or hardware leaderboard in the initial contract.
4. Return the exact criteria, bounded individual run examples and an explicit status. `matches` means one or more exact runs, `no_data` means zero exact runs, and `missing_conditions` means the request lacks a required reliable comparison value. Machine-readable reason codes explain states such as `unknown_game_resolution` or `game_version_missing`; they do not encode relaxation. A zero-match response does not provide runs from nearby hardware as substitutes.

The Position query sends comparison criteria, not the local run's FPS or full settings document. The desktop app adds its local run as a highlighted bar on the client. Opening Position requires consent before this query. Search with partial filters is broader by definition and still works immediately; strict exact comparison applies only when comparing a specified set of conditions.

### `POST /cohorts/query` — Position read

Transport policy (recorded 2026-09-22): require the `application/json` media type, matched case-insensitively, with optional parameters such as `charset=utf-8`. Missing or different media types (including `text/plain` and `application/*+json`) return `415 unsupported_media_type` using the standard error envelope. Validate media type before processing the body. The request body limit is **4 KiB (4096 bytes)**, inclusive, enforced while reading the stream before JSON parsing regardless of `Content-Length`. A larger body returns `413 payload_too_large`; malformed JSON, invalid UTF-8, an empty body or an invalid DTO returns `422 invalid_input`. This limit applies only to Position; publication payload size/depth limits remain a separate decision.

This anonymous, side-effect-free request sends only hardware and comparison conditions after the Windows user consents. It does not send the local run ID, FPS, settings snapshot or author identity. Hardware names are normalized by the server using the same rules as search/publication. Nullable values allow a completed local run with missing game-version or game-selected resolution to receive `missing_conditions`, rather than a misleading empty cohort. Map the saved `DisplaySettings.Resolution` pair when both dimensions are present and valid; do not substitute the Windows display mode. A malformed or unsupported value is `422 invalid_input`.

```http
POST /api/bench/v1/cohorts/query
Content-Type: application/json
```

```json
{
  "hardware": {"cpu_name": "Ryzen 7 7800X3D", "gpu_name": "GeForce RTX 4070 SUPER", "ram_gb": 32},
  "map": "lighthouse",
  "execution": "bsg_servers",
  "game_resolution": {"width": 2560, "height": 1440},
  "game_version": "0.16.9.0"
}
```

The response returns the canonical **exact** criteria, counts of matching runs and distinct contributors, and at most 20 individual public run summaries in `runs`. `truncated: true` means more exact runs exist; the complete set can be browsed through `GET /runs` using the returned canonical criteria. Multiple runs from one contributor remain separate and do not inflate `contributor_count`. No ranking, percentile, distribution, average of runs or widened match quality is returned.

```json
{
  "status": "matches",
  "criteria": {"hardware": {"cpu": {"id": "ryzen-7-7800x3d", "name": "Ryzen 7 7800X3D"}, "gpu": {"id": "geforce-rtx-4070-super", "name": "GeForce RTX 4070 SUPER"}, "ram_gb": 32}, "map": {"id": "lighthouse", "name": "Lighthouse"}, "execution": "bsg_servers", "game_resolution": {"width": 2560, "height": 1440}, "game_version": "0.16.9.0"},
  "counts": {"run_count": 1, "contributor_count": 1},
  "runs": [
    {"public_run_id": "br_8N4qP2vK", "url": "/bench/runs/br_8N4qP2vK", "captured_day": "2026-09-16", "map": {"id": "lighthouse", "name": "Lighthouse"}, "execution": "bsg_servers", "game_resolution": {"width": 2560, "height": 1440}, "game_version": "0.16.9.0", "metrics": {"average_fps": 121.0, "one_percent_low_fps": 82.0}}
  ],
  "truncated": false,
  "reason_codes": []
}
```

An exact query with no matching published run returns `200`, with the same criteria and no substitutes:

```json
{"status":"no_data","criteria":{"hardware":{"cpu":{"id":"ryzen-7-7800x3d","name":"Ryzen 7 7800X3D"},"gpu":{"id":"geforce-rtx-4070-super","name":"GeForce RTX 4070 SUPER"},"ram_gb":32},"map":{"id":"lighthouse","name":"Lighthouse"},"execution":"bsg_servers","game_resolution":{"width":2560,"height":1440},"game_version":"0.16.9.0"},"counts":{"run_count":0,"contributor_count":0},"runs":[],"truncated":false,"reason_codes":["no_exact_matches"]}
```

An unknown required condition does not query nearby cohorts:

```json
{
  "status": "missing_conditions",
  "criteria": {"hardware": {"cpu": {"id": "ryzen-7-7800x3d", "name": "Ryzen 7 7800X3D"}, "gpu": {"id": "geforce-rtx-4070-super", "name": "GeForce RTX 4070 SUPER"}, "ram_gb": 32}, "map": {"id": "lighthouse", "name": "Lighthouse"}, "execution": "bsg_servers", "game_resolution": null, "game_version": "0.16.9.0"},
  "counts": null,
  "runs": [],
  "truncated": false,
  "reason_codes": ["unknown_game_resolution"]
}
```

`status` is exactly one of `matches`, `no_data`, `missing_conditions`; `reason_codes` is empty for matches and uses reviewed enum values for other states. The desktop adds its own local FPS bar client-side. It must not label a single exact public run as a statistical cohort or a hardware potential.

### `POST /me/runs` — publish one selected local run

Requires a verified-email account and the Windows app's explicit per-run publication action. Browser search, My Bench and Position never publish. The request is a versioned sanitized DTO, not local `BenchmarkRun` JSON. `client_run_id` is a private UUID used for idempotency and may appear only in authenticated owner responses. The server chooses the public ID, canonical CPU/GPU/map IDs, publication status and author profile; it never trusts a submitted account ID, email, `submitted` flag or public ID.

The accepted top-level request keys are `schema_version`, `client_run_id`, `captured_day`, `app_version`, `hardware`, `map`, `execution`, `game_resolution`, `game_version`, `context`, `settings_snapshot`, `capture`, `metrics` and required `resource_telemetry`. `hardware` contains required nonempty `cpu_name`, `gpu_name`, normalized positive-integer `ram_gb` and optional `tuning_class` (`stock`, `overclocked`, `undervolted`, `mixed`, `unknown`). `map` is a canonical map ID; `execution` is `bsg_servers` or `local`. `game_resolution` is a width/height object mapped from the selected in-game screen resolution or `null`; `game_version` is a build string or `null`. `context.weather` is `unknown`, `clear`, `cloudy`, `rain`, `fog` or `snow`; `context.time_of_day` is `unknown`, `day`, `night` or `dawn_dusk`, matching the current app's answer codes. `settings_snapshot` is `null` when no reviewed keys were available, or a selected-key object with its own `schema_version: 1` and only the exact paths, types and values in [benchmark-settings-allowlist.md](benchmark-settings-allowlist.md). Unknown keys, extra objects and free text fail validation; whole `Game.ini`, `Graphics.ini` and `PostFx.ini` files are never accepted.

The selected-key settings snapshot is projected into approved public settings before storage; the raw snapshot is not stored as a second document. Extra RAM module models, GPU version details and SSD data are not required in this DTO and do not change search grouping. No raw CSV, local path, machine or hardware ID, email, Windows user/host name or free-text client warnings may be sent. The required `resource_telemetry` has strict nested allowlists and fixed reason codes, as specified in [the resource contract](../infrastructure/resource-telemetry.md#wire-contract). Its source/scope fields are reviewed literals, never native counter names or error text. The body limit is 256 KiB.

Complete accepted request for a legacy local run with explicit `not_collected` telemetry and selected settings; every FPS metric is one capture and `capture.duration_sec` is measured from valid frames. An updated client can explicitly submit this absent-collection state; an old client omitting the block is rejected. Its `game_resolution` is the selected screen resolution mapped from the saved game settings:

```http
POST /api/bench/v1/me/runs
Content-Type: application/json
```

```json
{
  "schema_version": 1,
  "client_run_id": "0ac1d9d2-4c89-4cda-a399-c5134cd7e948",
  "captured_day": "2026-09-16",
  "app_version": "1.0.3.0",
  "hardware": {"cpu_name": "Ryzen 7 7800X3D", "gpu_name": "GeForce RTX 4070 SUPER", "ram_gb": 32, "tuning_class": "unknown"},
  "map": "lighthouse",
  "execution": "bsg_servers",
  "game_resolution": {"width": 2560, "height": 1440},
  "game_version": "0.16.9.0",
  "context": {"weather": "unknown", "time_of_day": "day"},
  "settings_snapshot": {"schema_version": 1, "game": {"AutoEmptyWorkingSet": false, "SetAffinityToLogicalCores": true}, "graphics": {"DisplaySettings": {"FullScreenMode": 1, "Resolution": {"Width": 2560, "Height": 1440}}, "TextureQuality": 2, "ShadowsQuality": 0, "AntiAliasing": "TAA_High", "DLSSMode": "Off", "FSR2Mode": "Off", "FSR3Mode": "Off", "VSync": false, "HighQualityColor": false}, "postfx": {"EnablePostFx": false}},
  "capture": {"duration_sec": 118.7, "sample_count": 14363},
  "metrics": {"average_fps": 121.0, "one_percent_low_fps": 82.0, "zero_point_one_percent_low_fps": 54.0, "average_frametime_ms": 8.26, "p95_frametime_ms": 11.8, "p99_frametime_ms": 16.4},
  "resource_telemetry": {
    "schema_version": 1,
    "status": "not_collected",
    "window": {
      "requested_duration_sec": 0,
      "duration_sec": null,
      "target_interval_sec": 1,
      "expected_sample_count": 0,
      "alignment": "unknown",
      "coverage_method": "valid_interval_duration_gauges_capped_at_one_second"
    },
    "cpu": {
      "total_utilization": {
        "average": null,
        "minimum": null,
        "maximum": null,
        "last": null,
        "valid_sample_count": 0,
        "valid_duration_sec": 0,
        "coverage": 0,
        "unit": "percent",
        "source": "pdh_processor_information_processor_time",
        "scope": "whole_system",
        "status": "unavailable",
        "reason_codes": [
          "not_collected"
        ]
      },
      "logical_processors": []
    },
    "gpu": {
      "adapter_name": null,
      "scope": "whole_adapter",
      "memory_architecture": "unknown",
      "selection_method": "unknown",
      "selection_status": "unknown",
      "dedicated_vram_capacity": {
        "value": null,
        "unit": "bytes",
        "source": "dxgi_dedicated_video_memory",
        "scope": "whole_adapter",
        "status": "unavailable",
        "reason_codes": [
          "active_adapter_unknown"
        ]
      },
      "graphics_utilization": {
        "average": null,
        "minimum": null,
        "maximum": null,
        "last": null,
        "valid_sample_count": 0,
        "valid_duration_sec": 0,
        "coverage": 0,
        "unit": "percent",
        "source": "pdh_gpu_engine_3d_busiest_engine",
        "scope": "whole_adapter",
        "status": "unavailable",
        "reason_codes": [
          "active_adapter_unknown"
        ]
      },
      "dedicated_memory_used": {
        "average": null,
        "minimum": null,
        "maximum": null,
        "last": null,
        "valid_sample_count": 0,
        "valid_duration_sec": 0,
        "coverage": 0,
        "unit": "bytes",
        "source": "pdh_gpu_adapter_memory_dedicated",
        "scope": "whole_adapter",
        "status": "unavailable",
        "reason_codes": [
          "active_adapter_unknown"
        ]
      },
      "shared_memory_used": {
        "average": null,
        "minimum": null,
        "maximum": null,
        "last": null,
        "valid_sample_count": 0,
        "valid_duration_sec": 0,
        "coverage": 0,
        "unit": "bytes",
        "source": "pdh_gpu_adapter_memory_shared",
        "scope": "whole_adapter",
        "status": "unavailable",
        "reason_codes": [
          "active_adapter_unknown"
        ]
      }
    },
    "ram": {
      "installed_capacity": {
        "value": null,
        "unit": "bytes",
        "source": "get_physically_installed_system_memory",
        "scope": "whole_system",
        "status": "unavailable",
        "reason_codes": [
          "not_collected"
        ]
      },
      "os_usable_capacity": {
        "value": null,
        "unit": "bytes",
        "source": "get_performance_info_physical_total",
        "scope": "whole_system",
        "status": "unavailable",
        "reason_codes": [
          "not_collected"
        ]
      },
      "physical_used": {
        "average": null,
        "minimum": null,
        "maximum": null,
        "last": null,
        "valid_sample_count": 0,
        "valid_duration_sec": 0,
        "coverage": 0,
        "unit": "bytes",
        "source": "get_performance_info",
        "scope": "whole_system",
        "status": "unavailable",
        "reason_codes": [
          "not_collected"
        ]
      },
      "physical_available": {
        "average": null,
        "minimum": null,
        "maximum": null,
        "last": null,
        "valid_sample_count": 0,
        "valid_duration_sec": 0,
        "coverage": 0,
        "unit": "bytes",
        "source": "get_performance_info",
        "scope": "whole_system",
        "status": "unavailable",
        "reason_codes": [
          "not_collected"
        ]
      }
    },
    "pagefile": {
      "automatic_management": null,
      "automatic_management_scope": "system_policy",
      "automatic_management_source": "win32_computer_system_automatic_managed_pagefile",
      "file_count": {
        "average": null,
        "minimum": null,
        "maximum": null,
        "last": null,
        "valid_sample_count": 0,
        "valid_duration_sec": 0,
        "coverage": 0,
        "unit": "count",
        "source": "enum_page_files",
        "scope": "whole_system",
        "status": "unavailable",
        "reason_codes": [
          "not_collected"
        ]
      },
      "allocated": {
        "average": null,
        "minimum": null,
        "maximum": null,
        "last": null,
        "valid_sample_count": 0,
        "valid_duration_sec": 0,
        "coverage": 0,
        "unit": "bytes",
        "source": "enum_page_files",
        "scope": "whole_system",
        "status": "unavailable",
        "reason_codes": [
          "not_collected"
        ]
      },
      "used": {
        "average": null,
        "minimum": null,
        "maximum": null,
        "last": null,
        "valid_sample_count": 0,
        "valid_duration_sec": 0,
        "coverage": 0,
        "unit": "bytes",
        "source": "enum_page_files",
        "scope": "whole_system",
        "status": "unavailable",
        "reason_codes": [
          "not_collected"
        ]
      },
      "files": []
    },
    "commit": {
      "used": {
        "average": null,
        "minimum": null,
        "maximum": null,
        "last": null,
        "valid_sample_count": 0,
        "valid_duration_sec": 0,
        "coverage": 0,
        "unit": "bytes",
        "source": "get_performance_info",
        "scope": "whole_system",
        "status": "unavailable",
        "reason_codes": [
          "not_collected"
        ]
      },
      "limit": {
        "average": null,
        "minimum": null,
        "maximum": null,
        "last": null,
        "valid_sample_count": 0,
        "valid_duration_sec": 0,
        "coverage": 0,
        "unit": "bytes",
        "source": "get_performance_info",
        "scope": "whole_system",
        "status": "unavailable",
        "reason_codes": [
          "not_collected"
        ]
      },
      "headroom": {
        "average": null,
        "minimum": null,
        "maximum": null,
        "last": null,
        "valid_sample_count": 0,
        "valid_duration_sec": 0,
        "coverage": 0,
        "unit": "bytes",
        "source": "get_performance_info",
        "scope": "whole_system",
        "status": "unavailable",
        "reason_codes": [
          "not_collected"
        ]
      }
    },
    "warnings": [
      "not_collected",
      "active_adapter_unknown",
      "pagefile_management_unknown"
    ]
  }
}
```

An exact retry after moderator approval returns `200 OK` with the existing public receipt; POST never publishes automatically:

```json
{"client_run_id":"0ac1d9d2-4c89-4cda-a399-c5134cd7e948","publication_status":"published","public_run_id":"br_8N4qP2vK","url":"/bench/runs/br_8N4qP2vK"}
```

`202 Accepted` means held for review, not in public reads or comparisons:

```json
{"client_run_id":"0ac1d9d2-4c89-4cda-a399-c5134cd7e948","publication_status":"pending_review","public_run_id":null,"url":null}
```

A retry with the same account, `client_run_id` and identical validated payload returns the existing result (`200` if published; `202` if pending) without creating another run. The same key with changed payload returns `409 idempotency_conflict`; a new client ID with an already accepted run fingerprint returns `409 duplicate_run`. Retrying a deleted publication returns `409 publication_deleted`, never republishes it. Invalid captures return `422 invalid_input`; an uncertain network response is recovered using the same client ID or the owner lookup below. Published measurements are immutable.

Duplicate detection is per account and compares the canonical normalized measurement
already stored for pending, published or rejected submissions. Publication identifiers
and the synthetic marker are excluded; hardware uses normalized model IDs rather
than display names. Client IDs and app versions are not part of
the normalized measurement. The comparison and inserts share one D1 transaction.
The full request fingerprint remains separate for exact idempotent retries. Deletion
removes the measurement and its request fingerprint; its existing client-ID tombstone
still prevents retrying that deleted publication. No new fingerprint is retained to
link a deleted measurement to the anonymous archive.

### `GET /me/runs` and `GET /me/runs/by-client-id/{clientRunId}` — owner reads

Both require verified account ownership. `GET /me/runs` accepts `status=all|published|pending_review|rejected` (default `all`), `limit` (default 20, maximum 50) and opaque `cursor`; it orders by server `submitted_at` descending with a stable private tie-breaker. It lists server submissions, not the Windows app's complete local history. Deleted publications are excluded. Its cursor binds account, status and limit on a live keyset list without an insert watermark; changed parameters return `400 invalid_cursor`, and updates/deletions can invalidate it with `409 cursor_stale`. Owner cards require an aggregate `resource_telemetry` block without logical-processor/pagefile arrays; the following excerpt omits that block for space. Deleted lookup markers remain minimal and contain no telemetry.

```http
GET /api/bench/v1/me/runs?status=all&limit=20
```

```json
{
  "status_filter": "all",
  "limit": 20,
  "items": [
    {"client_run_id":"0ac1d9d2-4c89-4cda-a399-c5134cd7e948","publication_status":"published","public_run_id":"br_8N4qP2vK","url":"/bench/runs/br_8N4qP2vK","submitted_at":"2026-09-17T10:20:00Z","captured_day":"2026-09-16","hardware":{"cpu":"Ryzen 7 7800X3D","gpu":"GeForce RTX 4070 SUPER","ram_gb":32},"map":{"id":"lighthouse","name":"Lighthouse"},"execution":"bsg_servers","game_resolution":{"width":2560,"height":1440},"metrics":{"average_fps":121.0,"one_percent_low_fps":82.0},"status_reason":null},
    {"client_run_id":"f775f5f5-48ad-4c17-bf59-04f079d382a9","publication_status":"pending_review","public_run_id":null,"url":null,"submitted_at":"2026-09-16T09:00:00Z","captured_day":"2026-09-16","hardware":{"cpu":"Ryzen 7 7800X3D","gpu":"GeForce RTX 4070 SUPER","ram_gb":32},"map":{"id":"streets","name":"Streets of Tarkov"},"execution":"bsg_servers","game_resolution":null,"metrics":{"average_fps":96.0,"one_percent_low_fps":61.0},"status_reason":null}
  ],
  "next_cursor": null
}
```

`rejected` items have `public_run_id: null`, `url: null` and an approved `status_reason` code; internal moderation notes are never returned. An empty list returns `200`:

```json
{"status_filter":"all","limit":20,"items":[],"next_cursor":null}
```

The lookup by client ID returns `200` with `{ "item": <the same owner item shape> }` for published, pending or rejected submissions and `404 not_found` when absent or not owned. For a deleted submission it returns only `{ "item": {"client_run_id":"...","publication_status":"deleted","public_run_id":null,"url":null} }`, sufficient to prevent a lost acknowledgement from becoming a new publication. This lookup is owner-only and is never a public run URL.

Example deleted acknowledgement recovery:

```json
{"item":{"client_run_id":"0ac1d9d2-4c89-4cda-a399-c5134cd7e948","publication_status":"deleted","public_run_id":null,"url":null}}
```

### `DELETE /me/runs/{publicRunId}` — remove publication

Only the verified owner may remove a `published` run. A successful `200` response is returned after it has disappeared from search, detail, Position and public caches; local Windows history is unchanged. The measurement is retained only in the closed archive described below, with dates, source IDs and user links removed. An owner retry returns the same deletion acknowledgement without recreating the run.

```http
DELETE /api/bench/v1/me/runs/br_8N4qP2vK
```

```json
{"publication_status":"deleted","public_run_id":"br_8N4qP2vK"}
```

Afterward `GET /runs/br_8N4qP2vK` returns `404 not_found`. Another account's delete returns `403 not_owner`; an unknown public ID returns `404 not_found`. Deleting a `pending_review` submission remains a separate pre-implementation decision because it has no public run ID and this route cannot address it.

### Error response

All error responses use one flat JSON shape: `code` (stable machine code), English `message`, `request_id`, optional `field_errors` mapping field paths to reviewed error codes, and optional `retry_after_seconds`. They never echo rejected values, settings snapshots or credentials. Examples:

```json
{"code":"invalid_input","message":"The benchmark request is invalid.","request_id":"req_Q7n2","field_errors":{"capture.duration_sec":"too_short"}}
```

```json
{"code":"authentication_required","message":"Sign in to manage your benchmark runs.","request_id":"req_H4m8"}
```

```json
{"code":"not_found","message":"The public run was not found.","request_id":"req_J2b6"}
```

```json
{"code":"cursor_stale","message":"Search results changed. Start from the first page.","request_id":"req_D5v3"}
```

```json
{"code":"idempotency_conflict","message":"This local run ID was already submitted with different data.","request_id":"req_R8w1"}
```

Use `400 invalid_cursor`, `409 cursor_stale` or `409 group_key_stale` for paging tokens; `404 not_found` for absent public details or owner lookups; `401 authentication_required` and `403 email_verification_required`/`not_owner` for owner routes; `409 duplicate_run`, `idempotency_conflict` or `publication_deleted`; `415 unsupported_media_type` and `413 payload_too_large` for Position transport; `422 invalid_input`; and `429 rate_limited` with `retry_after_seconds`. `no_data` and `missing_conditions` in Position are successful `200` responses, not errors. Network failures have no server JSON response and the desktop handles them separately.

## Publication, errors and abuse

- Require verified email and explicit selection/review/affirmative publication choice for each submission. Saving locally and reading Position never submit. The user can keep a run local by not submitting it. Published measurement values cannot be edited; the owner can delete the published run from `My Bench` after confirmation. The existing local `submitted` Boolean and Google Form data provide no backend proof or migration source.
- Enforce a small request-size limit before JSON parsing; validate schema, settings keys/values, allowed fields and ranges; require a complete capture and plausible metrics. The current Windows Benchmark requests a 120-second PresentMon capture and discards it if fewer than 110 seconds of valid frametime data were collected or fewer than 120 frame samples were parsed. Its saved top-level `duration_sec` is the requested 120 seconds, while `performance.duration_sec` is calculated from actual samples. The server must validate the actual measured duration and count independently rather than trusting the top-level duration or the client-valid flag. Cross-check sample count, duration, Average FPS and mean frametime within a documented tolerance; reject impossible values and quarantine suspicious but plausible outliers. Do not silently rewrite measured FPS. A stricter requirement of 120 valid measured seconds would require changing the desktop validation and is not the current rule.
- Enforce uniqueness of `(account, client_run_id)` and compare a request fingerprint, without choosing the physical database design yet. Same key and same payload returns the original accepted or pending result; same key and different payload returns `409 idempotency_conflict`. A second distinct client ID with the same run fingerprint can return `409 duplicate_run`. An accepted response includes `public_run_id`, canonical URL and `publication_status: published`. A quarantined result returns `202` with `publication_status: pending_review`; the desktop app must not call that published.
- Standard JSON error shape: `code`, `message`, `request_id`, optional `field_errors` and `retry_after_seconds`. Use the exact status/code matrix above: `415 unsupported_media_type` and `413 payload_too_large` for Position transport, `422 invalid_input` for malformed field values, `400 invalid_cursor` for mismatched cursors, `409 cursor_stale`/`group_key_stale` for expired search snapshots, `401 authentication_required`, `403 email_verification_required`/`not_owner`, `409 duplicate_run`/`idempotency_conflict`/`publication_deleted`, and `429 rate_limited`. Position `no_data`/`missing_conditions` are successful `200` responses. The desktop handles network failure separately and retries with the same client run ID.
- Use approximate endpoint protection at the Worker edge, auth challenge throttling, and an exact per-account submission quota in authoritative server state. A nickname cannot be a limit key. Moderation changes visibility, not ownership. Turnstile can be added after abuse evidence.
- Current limits: 30 protected API authentication attempts per 60 seconds per connecting IP through Cloudflare (approximate, per location), and 50 accepted submissions per account over the rolling last 24 hours, checked atomically in D1. Deleted and rejected submissions still count; retries and rejected requests do not consume another slot. Both limits return `429 rate_limited` with `Retry-After` and `retry_after_seconds`.

## Data separation and exceptional removal

Keep email, sessions and ownership metadata private and separate from the public benchmark projection. Public API responses must select only approved fields. Distinct-contributor counts may use private ownership data internally, but must never expose its identifiers. Individual matching runs remain separate; no representative-run selection or distribution is needed for the initial exact-match contract. Physical tables, relationships and indexes will be designed after the public contract and actual queries are agreed.

Ordinary product flow does not edit published measurements. The authenticated owner can delete an individual publication in `My Bench`; ownership is checked against the private account ID, never a nickname. A successful deletion removes the run from anonymous search, cohorts, detail responses and caches; public detail then returns 404. The local capture in the Benchmark app is unaffected. Submission retries with the same `(account, client_run_id)` must not recreate a deleted publication; define the minimal private deletion marker and its retention before launch. This marker must not point to the retained measurement. The exact API response and behavior for pending-review submissions remain to be specified.

Agreed on 2026-09-26: after deletion, keep individual measurements in a closed internal archive for later Tarkov skill analysis. Retain hardware, conditions, capture duration/sample count, metrics and selected settings. Remove capture resource telemetry, captured/submitted/published dates, owner/account/contributor identifiers, public and client run IDs, public author name/avatar, request fingerprints and other source metadata. Give each archive record a new independent random ID; keep no mapping from the original run, submission or deletion marker to that record. The archive is not queried by public search, detail or Position, and does not restore a deleted publication. Keep the minimum owner/client/public-ID deletion acknowledgement separately for retry handling, without any archive link or measurement payload. The archive's retention period and future analysis remain to be agreed; this step does not introduce an expiry job or a public archive endpoint. Describe this storage behavior before publication and in the privacy policy before launch.

This control does not replace other data-subject rights: before launch, choose and document a lawful basis for public publication, provide an accessible process for withdrawal/erasure or objection as applicable, and handle valid requests without undue delay. Do not impose a blanket one-year wait before requests can be made. If publication relies on GDPR consent, withdrawal must be possible at any time and as easily as consent was given. A private account link to a public run means that simply hiding the email or using an opaque run ID does not make the stored record anonymous. Moderation must also be able to quarantine or remove fraudulent, erroneous or privacy-sensitive material. Finalize account-deletion behavior and operational retention before launch and update `PRIVACY.md`. Keep auth and submission logs minimal and time-limited.

## Decisions to settle before implementation

1. The selected game screen-resolution mapping was verified by controlled UI changes in Borderless, Windowed and Fullscreen; it is distinct from Windows display resolution and may now populate `game_resolution`. The field does not claim measured internal or monitor output resolution. The current `RaidLogReader` extracts game version from a 4- or 5-part numeric suffix in the log-folder name and stores `finalContext.GameVersion`; if absent, it is `null`. Exact build matching is agreed; the reliability of that source across supported installations still needs real-run validation.
2. Define the production canonical CPU/GPU model catalog, installed-RAM normalization rule and map IDs. Selectable web options now come from the observed-public-values endpoint described above; this does not settle production normalization. Group equality and query syntax are fixed above, but the precise normalization of raw Windows names and fractional RAM totals must be validated against examples. Extra RAM module models, GPU version details and SSD data remain outside the v1 grouping/filter contract.
3. Review and approve the proposed [settings allowlist v1](benchmark-settings-allowlist.md) and make the Windows client map only those keys; the server rejects whole files and unlisted keys. The important graphics fields are accepted as bounded saved tokens/codes and shown in run details without inventing missing UI labels. Automatic RAM Cleaner, physical-cores and the three `FullScreenMode` values were confirmed by controlled UI changes; revisit them only if a later game version changes their semantics. Enumerate quality and upscaling code sets and slider ranges to refine labels and safety bounds; deferred paths remain rejected until reviewed. PostFX public detail needs only the saved enabled state; sliders remain outside search and Position. Set the publication request-size/depth limits (Position transport is specified above) and approved `quality_notes`/owner `status_reason` codes.
4. Confirm publication metric consistency tolerances, suspicious-outlier handling and exact server acceptance thresholds against actual captures. The current desktop requests 120 seconds, requires at least 110 valid measured seconds and 120 parsed frame samples; it does not guarantee 120 valid seconds. Set the cursor/group-key lifetime and snapshot-expiry policy without weakening the pagination and removal guarantees above.
5. Select and prove the verified-email auth provider, browser-to-Windows return and revocable credential storage. Define the optional public profile source and avatar hosting; neither may be inferred from email. No provider-specific fields enter benchmark product responses.
6. Define pending-review deletion, rejection and moderation transitions, owner account deletion, deletion-marker retention, replacement after erroneous publication, and the anonymization/retention procedure for measurements kept for skill analysis. Document the publication's legal basis and withdrawal/erasure or objection process before launch. These choices must preserve the response states and public removal behavior specified above.

## Contract tests before release

Test public allowlists by snapshotting search, detail, Position and error responses against forbidden private keys; auth and owner isolation, including owner deletion and rejection of another account's deletion request; exact idempotent retry and owner lookup after lost acknowledgement; no republication after deletion and retry; conflict on changed payload; pending versus published state; immutable published measurements; removal from all public reads and caches; separation of deletion markers from retained measurements; anonymization and discard when anonymity cannot be established; malformed, oversized and extra-key payloads; exact Position boundaries, `no_data` and `missing_conditions` without widening; partial-filter search and grouped cards that keep each run's metrics distinct; `items` continuation, cursor binding and stale snapshots after removals; rate limits; and browser/Desktop session separation. Review `PRIVACY.md` against actual stored fields and retention.

## D1 storage implementation decision (2026-09-22)

The public read implementation now uses persistent D1 with Drizzle schema and generated Wrangler
migrations. Navigation snapshots have a fixed 30-minute lifetime, exclude later ingestion sequences,
and conservatively become stale after any run UPDATE or DELETE. Client-held signed tokens bind
filters/sort/view/group/page limit and use keyset continuation. Reads go to primary D1; removed runs
are never read from historic documents. Production has no fixture fallback or seed. See
[infrastructure/README.md](../infrastructure/README.md#d1-persistence-and-migrations) for the precise
expiry/removal rules, schema organization, query costs, safe deployment order and staging cases.
This resolves navigation expiry in open question 4; publication/auth/ownership remain out of scope.


### Client-held navigation implementation

Public D1 search uses versioned HMAC-signed cursors/group tokens carried by the client.
The API stores no navigation tokens. A groups request may send a previously issued group
token as `snapshot` to preserve expansion across Back/reload. Its filters/sort and snapshot
are validated; supplying conflicting cursor/group snapshots is rejected. The fixed 30-minute
expiry and dataset-revision invalidation still apply. The server signing secret is configured
per environment. Old database-backed links expire when the token table is removed.
