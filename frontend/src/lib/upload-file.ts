import {
  ApiError,
  completeUpload,
  getUploadStatus,
  initUpload,
  putChunk,
} from "./api";

export type UploadResult = {
  fileId: string;
  filename: string;
  size: number;
  /** Tidak tersedia kalau hasil didapat dari pengecekan status (resume). */
  sha256?: string;
};

export type UploadFileOptions = {
  /** Ukuran chunk yang diminta; tidak boleh melebihi batas server. */
  chunkSize: number;
  signal: AbortSignal;
  /** uploadId dari percobaan sebelumnya, supaya chunk yang sudah terkirim tidak diulang. */
  resumeId?: string;
  /** Jumlah chunk yang dikirim bersamaan. */
  concurrency?: number;
  onStarted?: (uploadId: string) => void;
  onProgress?: (uploadedBytes: number) => void;
};

type Session = {
  uploadId: string;
  chunkSize: number;
  totalChunks: number;
  received: Set<number>;
};

const MAX_ATTEMPTS = 3;

/**
 * Mengunggah satu file secara bertahap:
 * init (atau resume) -> kirim chunk paralel dengan retry -> complete.
 */
export async function uploadFile(
  file: File,
  opts: UploadFileOptions,
): Promise<UploadResult> {
  const { signal, concurrency = 3 } = opts;

  let session: Session | null = null;
  if (opts.resumeId) {
    const resumed = await resume(opts.resumeId, file, signal);
    if (resumed && "fileId" in resumed) {
      opts.onProgress?.(file.size);
      return resumed;
    }
    session = resumed;
  }
  if (!session) {
    const totalChunks = Math.ceil(file.size / opts.chunkSize);
    const res = await withRetry(
      () =>
        initUpload(
          {
            filename: file.name,
            size: file.size,
            mimeType: file.type,
            chunkSize: opts.chunkSize,
            totalChunks,
          },
          signal,
        ),
      signal,
    );
    session = { ...res, received: new Set() };
  }
  opts.onStarted?.(session.uploadId);

  const s = session;
  const chunkBytes = (i: number) =>
    Math.min(s.chunkSize, file.size - i * s.chunkSize);

  let uploaded = 0;
  for (const i of s.received) uploaded += chunkBytes(i);
  opts.onProgress?.(uploaded);

  const sendChunks = (indexes: number[]) =>
    runPool(indexes, concurrency, async (i) => {
      const start = i * s.chunkSize;
      const blob = file.slice(start, start + s.chunkSize);
      await withRetry(() => putChunk(s.uploadId, i, blob, signal), signal);
      if (!s.received.has(i)) {
        s.received.add(i);
        uploaded += chunkBytes(i);
        opts.onProgress?.(uploaded);
      }
    });

  const pending = Array.from({ length: s.totalChunks }, (_, i) => i).filter(
    (i) => !s.received.has(i),
  );
  await sendChunks(pending);

  for (let attempt = 0; ; attempt++) {
    try {
      return await withRetry(() => completeUpload(s.uploadId, signal), signal);
    } catch (err) {
      if (!(err instanceof ApiError) || err.status !== 409) throw err;

      // Server menganggap masih ada chunk yang kurang: kirim ulang sekali.
      if (err.missingChunks?.length && attempt === 0) {
        for (const i of err.missingChunks) {
          if (s.received.delete(i)) uploaded -= chunkBytes(i);
        }
        await sendChunks(err.missingChunks);
        continue;
      }

      // Upload sudah tidak aktif. Bisa jadi complete sebelumnya sebenarnya
      // berhasil tetapi responsnya hilang di jalan, jadi cek statusnya.
      const status = await getUploadStatus(s.uploadId, signal);
      if (status.status === "completed") {
        return {
          fileId: status.uploadId,
          filename: status.filename,
          size: status.size,
        };
      }
      throw err;
    }
  }
}

async function resume(
  uploadId: string,
  file: File,
  signal: AbortSignal,
): Promise<Session | UploadResult | null> {
  try {
    const st = await getUploadStatus(uploadId, signal);
    if (st.size !== file.size) return null;
    if (st.status === "completed") {
      return { fileId: st.uploadId, filename: st.filename, size: st.size };
    }
    if (st.status === "canceled") return null;
    return {
      uploadId: st.uploadId,
      chunkSize: st.chunkSize,
      totalChunks: st.totalChunks,
      received: new Set(st.receivedChunks),
    };
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

function isRetryable(err: unknown): boolean {
  if (err instanceof ApiError) {
    return err.status >= 500 || err.status === 408 || err.status === 429;
  }
  // fetch melempar TypeError untuk kegagalan jaringan.
  return err instanceof TypeError;
}

async function withRetry<T>(
  fn: () => Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (signal.aborted || attempt >= MAX_ATTEMPTS || !isRetryable(err)) {
        throw err;
      }
      await sleep(500 * 2 ** (attempt - 1), signal);
    }
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** Menjalankan worker untuk setiap item dengan maksimal `limit` sekaligus. */
export async function runPool<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  let failed = false;
  const run = async () => {
    while (!failed && next < items.length) {
      const item = items[next++];
      try {
        await worker(item);
      } catch (err) {
        failed = true;
        throw err;
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, run),
  );
}

export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}
