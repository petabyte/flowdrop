# n8n-nodes-flowdrop

An [n8n](https://n8n.io) community node for [FlowDrop](https://flowdrop-production-6e1e.up.railway.app/) — API-first file hosting powered by Cloudflare R2.

Upload files, manage your storage, and integrate FlowDrop into any n8n automation workflow.

---

## Installation

In your n8n instance:

1. Go to **Settings** → **Community Nodes**
2. Click **Install**
3. Enter `n8n-nodes-flowdrop`
4. Click **Install** and restart n8n if prompted

The **FlowDrop** node will appear in the node palette.

---

## Credentials

After installation, create a **FlowDrop API** credential:

1. Go to **Credentials** → **New**
2. Search for **FlowDrop API**
3. Fill in:
   - **API Key** — your FlowDrop API key (found in the Account tab of your dashboard)
   - **Base URL** — the root URL of your FlowDrop instance (e.g. `https://yourapp.railway.app`)
4. Click **Test** to verify the connection, then **Save**

---

## Operations

### Upload File

Upload a binary file and receive a public CDN URL.

| Parameter | Description |
|---|---|
| Binary Property | Name of the binary property in the incoming item (default: `data`) |
| Filename Override | Optional — override the uploaded filename |

**Output:** One item per uploaded file, including the public URL, file key, size, and metadata.

---

### Delete File

Delete a file from your storage by its R2 key.

| Parameter | Description |
|---|---|
| File Key | The R2 object key of the file to delete (e.g. `abc123.jpg`) |

---

### List Files

List your uploaded files with optional pagination and tier filtering.

| Parameter | Description |
|---|---|
| Limit | Number of files to return (1–100, default: 20) |
| Offset | Number of files to skip for pagination (default: 0) |
| Tier Filter | Filter by subscription tier: All, Free, Starter, or Pro |

**Output:** One item per file.

---

### Get File Info

Retrieve metadata for a specific file by its R2 key.

| Parameter | Description |
|---|---|
| File Key | The R2 object key of the file (e.g. `abc123.jpg`) |

**Output:** File metadata including URL, size, MIME type, and upload date.

---

## Example Workflow

1. **HTTP Request** or **Read Binary File** → produces a binary item
2. **FlowDrop** (Upload File) → outputs the public CDN URL and file metadata
3. Use the URL downstream — send it in an email, store it in a database, post it to Slack, etc.

---

## Requirements

- n8n v0.190.0 or later
- A running FlowDrop instance with a valid API key

---

## License

MIT
