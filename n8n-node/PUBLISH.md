# Publishing n8n-nodes-flowdrop to npm

## Prerequisites

- Node.js 18+ installed
- An npm account — create one free at [npmjs.com](https://www.npmjs.com)

---

## Step 1 — Build the package

From the repo root:

```bash
cd n8n-node
npm install
npm run build
```

Expected: `dist/` folder is created containing:
- `dist/credentials/FlowDropApi.credentials.js`
- `dist/nodes/FlowDrop/FlowDrop.node.js`

---

## Step 2 — Log in to npm

```bash
npm login
```

This opens a browser window to authenticate. Enter your npm username and password when prompted.

Verify you're logged in:

```bash
npm whoami
```

---

## Step 3 — Dry run (check what gets published)

```bash
npm publish --dry-run
```

The output should list only:
- `dist/`
- `index.js`
- `package.json`

The `src/` folder and `node_modules/` should **not** appear. If they do, check the `files` field in `package.json`.

---

## Step 4 — Publish

```bash
npm publish --access public
```

Expected output:
```
+ n8n-nodes-flowdrop@0.1.0
```

View your published package at:
```
https://www.npmjs.com/package/n8n-nodes-flowdrop
```

---

## Step 5 — Install in n8n

In any n8n instance:

1. Go to **Settings** → **Community Nodes**
2. Click **Install**
3. Type `n8n-nodes-flowdrop`
4. Click **Install**
5. Restart n8n if prompted

The **FlowDrop** node will appear in the node palette.

---

## Step 6 — Configure credentials in n8n

1. In n8n, go to **Credentials** → **New**
2. Search for **FlowDrop API**
3. Fill in:
   - **API Key** — your FlowDrop API key (found in the Account tab of your dashboard)
   - **Base URL** — `https://flowdrop-production.up.railway.app` (your deployed app URL)
4. Click **Test** — you should see a green checkmark
5. Click **Save**

---

## Available Operations

| Operation | What it does |
|---|---|
| **Upload File** | Upload a file and get a public CDN URL back |
| **Delete File** | Delete a file by its R2 key |
| **List Files** | List your uploaded files with pagination and tier filter |
| **Get File Info** | Get metadata for a specific file by its R2 key |

---

## Publishing a New Version

After making changes to the node:

1. Bump the version in `package.json` (follow semver — e.g. `0.1.0` → `0.1.1` for a patch)
2. Rebuild: `npm run build`
3. Publish: `npm publish --access public`

Users can update from n8n: **Settings** → **Community Nodes** → click **Update** next to `n8n-nodes-flowdrop`.

---

## Troubleshooting

**"You must be logged in" error**
Run `npm login` and try again.

**"Package name already taken"**
The name `n8n-nodes-flowdrop` is already on npm. Change the `name` field in `package.json` to something unique (e.g. `n8n-nodes-flowdrop-yourname`) and republish.

**Credential test fails in n8n**
- Make sure the Base URL has no trailing slash
- Make sure your FlowDrop app is deployed and `/api/health` returns `200`
- Check that your API key is correct (copy it from the Account tab in your dashboard)

**Node doesn't appear after install**
Restart n8n after installing the community node.
