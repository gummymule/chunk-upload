# Chunk Upload

Upload multiple files from the browser by splitting each one into chunks. A failed or interrupted upload resumes from the chunks already received instead of starting over.

- **Backend:** Go (`net/http`), SQLite (`modernc.org/sqlite`, no CGO), local disk storage
- **Frontend:** Next.js 16, React 19, react-hook-form, zod, TanStack Query, react-dropzone, Tailwind CSS 4

## How it works

```
Browser                                   Backend
───────                                   ───────
GET  /api/config                  ──▶     upload limits (max file size, max chunk size)
POST /api/uploads                 ──▶     create an upload session → uploadId
PUT  /api/uploads/{id}/chunks/0   ──▶     store chunk
PUT  /api/uploads/{id}/chunks/1   ──▶     (3 chunks in parallel, retried on failure)
...
POST /api/uploads/{id}/complete   ──▶     join chunks, verify size, compute SHA-256
GET  /api/files/{id}              ──▶     download the final file
```

- Each chunk is written to a temporary file and then renamed, so a partially written chunk is never treated as complete. Re-sending a chunk simply overwrites it.
- The final file only appears once all chunks are joined and the total size is verified.
- To resume, the client calls `GET /api/uploads/{id}` and sends only the chunks missing from `receivedChunks`.

## Project structure

```
backend/
  cmd/server/main.go          entry point, routing, CORS
  internal/config/            environment configuration
  internal/database/          SQLite connection and schema
  internal/storage/           chunk storage and file assembly on disk
  internal/upload/            handler (HTTP), service (logic), repository (DB)
frontend/
  src/app/                    layout, page, TanStack Query provider
  src/components/upload/      dropzone form, upload list
  src/hooks/use-uploads.ts    per-file upload state, cancel, retry
  src/lib/api.ts              API client (responses validated with zod)
  src/lib/upload-file.ts      chunking, parallel sending, retry, resume
  src/lib/upload-schema.ts    zod schema for the upload form
```

## Running locally

Requirements: **Go 1.26+** and **Node.js 20+**.

### Backend

```bash
cd backend
go run ./cmd/server
```

The server listens on `http://localhost:8080`. The database and files are stored in `backend/data/`, which is created automatically.

### Frontend

```bash
cd frontend
cp .env.example .env.local   # optional; the default already points to localhost:8080
npm install
npm run dev
```

Open `http://localhost:3000`.

## Configuration

### Backend (environment variables)

| Variable        | Default                 | Description                                                    |
| --------------- | ----------------------- | -------------------------------------------------------------- |
| `PORT`          | `8080`                  | HTTP server port                                               |
| `DB_PATH`       | `./data/app.db`         | SQLite file location                                           |
| `STORAGE_DIR`   | `./data`                | Folder for chunks (`tmp/`) and final files (`files/`)          |
| `MAX_FILE_SIZE` | `20971520` (20 MB)      | Maximum size per file, in bytes                                |
| `CHUNK_SIZE`    | `1048576` (1 MB)        | Maximum chunk size, in bytes                                   |
| `CORS_ORIGIN`   | `http://localhost:3000` | Frontend origin allowed to call the API (`*` allows any origin) |

The backend does not read `.env` files on its own. Set the variables in your shell, or see `backend/.env.example` for an example.

### Frontend

| Variable              | Default                 | Description     |
| --------------------- | ----------------------- | --------------- |
| `NEXT_PUBLIC_API_URL` | `http://localhost:8080` | Backend base URL |

`NEXT_PUBLIC_*` variables are baked in when you run `next build`, so rebuild after changing them.

The file size limit and chunk size are **not** set in the frontend. They come from `GET /api/config`, so the form validation always matches the server.

## API

All responses are JSON. Errors use the format `{"error": "message"}`.

### `GET /api/config`

```json
{ "maxFileSize": 20971520, "chunkSize": 1048576 }
```

### `POST /api/uploads`

Starts an upload session.

```json
// request
{ "filename": "report.pdf", "size": 2621440, "mimeType": "application/pdf", "chunkSize": 1048576, "totalChunks": 3 }
// 201 response
{ "uploadId": "f31b1da3-...", "chunkSize": 1048576, "totalChunks": 3 }
```

`totalChunks` must equal `ceil(size / chunkSize)`, and `chunkSize` must not exceed `CHUNK_SIZE`. Returns `400` for invalid input and `413` if the file is too large.

### `PUT /api/uploads/{id}/chunks/{index}`

The request body is the raw chunk bytes (`application/octet-stream`). Every chunk must be exactly `chunkSize` bytes, except the last one, which holds the remainder. Returns `200 {"index": 0, "size": 1048576}`, or `400` if the size doesn't match.

### `GET /api/uploads/{id}`

Upload status, used for resuming.

```json
{
  "uploadId": "f31b1da3-...", "filename": "report.pdf", "size": 2621440,
  "status": "uploading", "chunkSize": 1048576, "totalChunks": 3, "receivedChunks": [0, 2]
}
```

`status` is one of `uploading`, `completing`, `completed` or `canceled`.

### `POST /api/uploads/{id}/complete`

Joins the chunks into the final file.

```json
// 200
{ "fileId": "f31b1da3-...", "filename": "report.pdf", "size": 2621440, "sha256": "7239..." }
// 409 if chunks are missing
{ "error": "chunk belum lengkap", "missingChunks": [1] }
```

Also returns `409` if the upload is no longer active (already completed or canceled).

### `DELETE /api/uploads/{id}`

Cancels an upload and deletes its chunks. Returns `204`. Calling it again on an upload that's already canceled is safe.

### `GET /api/files/{id}`

Downloads the final file as an attachment, with support for the `Range` header. Returns `404` if the upload hasn't completed.

## Frontend behavior

- Up to **10 files** per upload. Each file must be non-empty, within the server limit, and have a name of at most 255 bytes. Errors are shown next to each file.
- **2 files** upload at a time, and each file sends **3 chunks** in parallel.
- Network errors and `5xx`/`408`/`429` responses are retried up to 3 times with backoff.
- **Retry** continues from the chunks already received. **Cancel** stops the requests and deletes the session on the server.
- If a `complete` response is lost and the retry gets `409`, the client checks the upload status. If the upload is already `completed`, it counts as a success.
- The browser warns before closing the tab while an upload is running.

## Known limitations

- Abandoned `uploading` sessions and their chunks are never cleaned up automatically.
- If the server stops while joining chunks, the upload stays in `completing`.
- The SHA-256 isn't stored, so it's only available in the first `complete` response.
- There is no authentication: anyone who can reach the API can upload and download files.
- There is no graceful shutdown.
