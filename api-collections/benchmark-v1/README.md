# Benchmark request collection

Open this directory in Bruno and choose `Local` or `Staging`. Requests read only
published benchmark data, except Position's read-only comparison POST. There are no
authenticated submission, moderation or deletion requests; running the collection
cannot upload a capture or publish a result.

`API` contains editable public endpoint requests. Search groups saves a group key;
Runs in group saves a public ID for Run details. Repeat any changed filters/sort when
expanding a group. The fallback `br_test_01` belongs to standard fixtures; with the
larger demo dataset, run Search groups and Runs in group first.

`Smoke flow` checks public search/pagination/details, Position and hidden/deleted
fixture reads. Its 32 GB filter works with both standard and larger demo datasets.
Details checks include required telemetry and excluded private fields. Search and
Position retain their smaller response projections.

`Resource telemetry` reads eight stable demo IDs: ordinary capture, near-full VRAM,
low available RAM, low commit headroom, partial, unavailable, multiple pagefiles and
UMA. It requires the full demo dataset, including the added UMA run. From the
repository root, explicitly seed the local database with:

```sh
npm run db:seed:demo:local
```

This seed does not reset unrelated data. Staging data preparation is a separately
approved remote operation after merge. With Bruno CLI installed, from this directory:

```sh
bru run "Smoke flow" --env Local
bru run "Resource telemetry" --env Local
```

All resource examples are invented and carry `is_synthetic: true`. Failed collection
does not turn null readings into zero or invalidate FPS. A near-full VRAM example
does not establish a cause of FPS drops. For exact fields, sharing/privacy scope,
frozen-request retry rules and desktop changes, see
[the resource contract and handoff](../../infrastructure/resource-telemetry.md).
The complete version-1 submission JSON example is in
[the backend contract](../../design/benchmark-backend-draft.md#post-meruns--publish-one-selected-local-run);
it is reference material and is not sent by this collection.
