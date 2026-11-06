import { z } from "zod";

export const API_URL = (
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080"
).replace(/\/+$/, "");

export class ApiError extends Error {
  readonly status: number;
  readonly missingChunks?: number[];

  constructor(status: number, message: string, missingChunks?: number[]) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.missingChunks = missingChunks;
  }
}

const errorBodySchema = z.object({
  error: z.string(),
  missingChunks: z.array(z.number().int()).optional(),
});

async function send(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`${API_URL}${path}`, init);
  if (!res.ok) {
    const body = errorBodySchema.safeParse(await res.json().catch(() => null));
    throw new ApiError(
      res.status,
      body.success ? body.data.error : `HTTP ${res.status}`,
      body.success ? body.data.missingChunks : undefined,
    );
  }
  return res;
}

// --- GET /api/config -------------------------------------------------------

const configSchema = z.object({
  maxFileSize: z.number().int().positive(),
  chunkSize: z.number().int().positive(),
});
export type UploadConfig = z.infer<typeof configSchema>;

export async function getConfig(signal?: AbortSignal): Promise<UploadConfig> {
  const res = await send("/api/config", { signal });
  return configSchema.parse(await res.json());
}

// --- POST /api/uploads -----------------------------------------------------

export type InitUploadInput = {
  filename: string;
  size: number;
  mimeType: string;
  chunkSize: number;
  totalChunks: number;
};

const initResponseSchema = z.object({
  uploadId: z.string(),
  chunkSize: z.number().int().positive(),
  totalChunks: z.number().int().positive(),
});

export async function initUpload(input: InitUploadInput, signal?: AbortSignal) {
  const res = await send("/api/uploads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal,
  });
  return initResponseSchema.parse(await res.json());
}

// --- GET /api/uploads/{id} -------------------------------------------------

const statusSchema = z.object({
  uploadId: z.string(),
  filename: z.string(),
  size: z.number().int(),
  status: z.enum(["uploading", "completing", "completed", "canceled"]),
  chunkSize: z.number().int().positive(),
  totalChunks: z.number().int().positive(),
  receivedChunks: z.array(z.number().int()),
});
export type UploadStatusResponse = z.infer<typeof statusSchema>;

export async function getUploadStatus(id: string, signal?: AbortSignal) {
  const res = await send(`/api/uploads/${encodeURIComponent(id)}`, { signal });
  return statusSchema.parse(await res.json());
}

// --- PUT /api/uploads/{id}/chunks/{index} ----------------------------------

export async function putChunk(
  id: string,
  index: number,
  chunk: Blob,
  signal?: AbortSignal,
): Promise<void> {
  await send(`/api/uploads/${encodeURIComponent(id)}/chunks/${index}`, {
    method: "PUT",
    headers: { "Content-Type": "application/octet-stream" },
    body: chunk,
    signal,
  });
}

// --- POST /api/uploads/{id}/complete ---------------------------------------

const completeSchema = z.object({
  fileId: z.string(),
  filename: z.string(),
  size: z.number().int(),
  sha256: z.string(),
});
export type CompleteResponse = z.infer<typeof completeSchema>;

export async function completeUpload(id: string, signal?: AbortSignal) {
  const res = await send(`/api/uploads/${encodeURIComponent(id)}/complete`, {
    method: "POST",
    signal,
  });
  return completeSchema.parse(await res.json());
}

// --- DELETE /api/uploads/{id} ----------------------------------------------

export async function cancelUpload(id: string): Promise<void> {
  await send(`/api/uploads/${encodeURIComponent(id)}`, { method: "DELETE" });
}

// --- GET /api/files/{id} ---------------------------------------------------

export function fileUrl(fileId: string): string {
  return `${API_URL}/api/files/${encodeURIComponent(fileId)}`;
}
