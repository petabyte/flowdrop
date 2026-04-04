# n8n Community Node — Design Spec

**Date:** 2026-04-03
**Status:** Approved

---

## Context

FlowDrop's landing page already documents n8n integration via the HTTP Request node. This spec formalises that into a proper n8n community node (`n8n-nodes-flowdrop`) — a TypeScript package users install directly from the n8n UI. It gives FlowDrop a native presence in n8n's node palette with a proper credentials panel, operation picker, and typed inputs/outputs.

---

## Approach

Single node with operation picker. One `FlowDrop` node appears in the n8n palette. Users select the operation from a dropdown. Standard community node pattern — clean UX, one thing to find and install.

**New dependencies (in `n8n-node/`):**
- `n8n-workflow` — peer dependency, provides base node types
- `typescript` — build tooling
- `@types/node` — type definitions

---

## Section 1 — Package Structure

Lives in `n8n-node/` at the repo root — a standalone npm package, separate from the Express server.

```
n8n-node/
├── package.json          # name: "n8n-nodes-flowdrop"
├── tsconfig.json
├── index.js              # entry point → compiled dist/
└── src/
    ├── credentials/
    │   └── FlowDropApi.credentials.ts
    └── nodes/
        └── FlowDrop/
            ├── FlowDrop.node.ts
            └── flowdrop.svg
```

**Compiled output:** `dist/` via `tsc`. Excluded from git.

**Required `package.json` fields:**
```json
{
  "name": "n8n-nodes-flowdrop",
  "version": "0.1.0",
  "n8n": {
    "n8nNodesApiVersion": 1,
    "credentials": ["dist/credentials/FlowDropApi.credentials.js"],
    "nodes": ["dist/nodes/FlowDrop/FlowDrop.node.js"]
  },
  "scripts": {
    "build": "tsc --project tsconfig.json",
    "dev": "tsc --watch"
  }
}
```

**`tsconfig.json`:** targets `ES2019`, outputs to `dist/`, strict mode on — matches n8n's compiler settings.

**`.gitignore` in `n8n-node/`:** excludes `dist/` and `node_modules/`.

---

## Section 2 — Credentials

Credential type: `FlowDropApi`. Configured once in n8n, reused across all FlowDrop nodes.

**Fields shown in the credentials panel:**

| Field | Type | Description |
|---|---|---|
| `apiKey` | Password | The user's FlowDrop API key (copied from their dashboard) |
| `baseUrl` | String | Base URL of their FlowDrop instance — e.g. `https://yourapp.railway.app` |

The node appends `/api/...` paths internally. The user only enters the root URL — no trailing slash, no `/api` suffix needed.

**Credential test:** A `test` block hits `GET ${baseUrl}/api/health`. Returns 200 → credential marked valid in the n8n panel.

---

## Section 3 — Node Operations

Defined in `FlowDrop.node.ts`. All operations use `this.helpers.httpRequest()` which automatically injects `apiKey` as the `x-api-key` header from the credential.

### Upload File

- **Input:** Binary file data from the previous node, optional `filename` override
- **Request:** `POST ${baseUrl}/api/upload` — `multipart/form-data`
- **Output:** `{ url, key, filename, size, tier, expiresAt }`

### Delete File

- **Input:** `key` — R2 object key (e.g. `abc123.jpg`)
- **Request:** `DELETE ${baseUrl}/api/files/:key`
- **Output:** `{ success, message }`

### Get File Info

- **Input:** `key`
- **Request:** `GET ${baseUrl}/api/files?limit=1` — filtered by key client-side from the response
- **Output:** Single file object `{ url, filename, size, tier, uploadedAt, expiresAt }`

### List Files

- **Input:** `limit` (default 20, max 100), `offset` (default 0), optional `tier` filter (`free`, `starter`, `pro`)
- **Request:** `GET ${baseUrl}/api/files?limit=&offset=&tier=`
- **Output:** `{ count, files[] }` — each file as a separate n8n item for natural chaining

---

## Section 4 — Build & Publish

### Local development & testing

```bash
cd n8n-node
npm install
npm run build
npm link
```

In n8n instance settings: add `n8n-nodes-flowdrop` as a custom community node path to test without publishing.

### Publishing to npm

```bash
cd n8n-node
npm run build
npm publish --access public
```

Once published, users install via n8n UI: **Settings → Community Nodes → Install** → `n8n-nodes-flowdrop`.

### Versioning

Start at `0.1.0`. Bump minor on new operations, patch on bug fixes. Since the node and API live in the same repo, API changes and node updates ship together.

---

## Files Created

| File | Description |
|---|---|
| `n8n-node/package.json` | Package manifest with n8n metadata |
| `n8n-node/tsconfig.json` | TypeScript compiler config |
| `n8n-node/index.js` | Entry point |
| `n8n-node/src/credentials/FlowDropApi.credentials.ts` | API key + baseUrl credential type |
| `n8n-node/src/nodes/FlowDrop/FlowDrop.node.ts` | Main node — all 4 operations |
| `n8n-node/src/nodes/FlowDrop/flowdrop.svg` | Node icon |
| `n8n-node/.gitignore` | Excludes `dist/`, `node_modules/` |

---

## Verification

1. `npm run build` completes without TypeScript errors
2. Node appears in n8n palette after installation
3. Credentials panel shows `apiKey` and `baseUrl` fields; test button hits `/api/health` and passes
4. **Upload File:** binary input from an HTTP node uploads successfully, output contains a valid public URL
5. **Delete File:** deletes a known key, subsequent Get File Info returns empty
6. **Get File Info:** returns correct metadata for an existing key
7. **List Files:** returns paginated results; `tier` filter returns only matching uploads
