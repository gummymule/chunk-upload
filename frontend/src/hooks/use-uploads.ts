"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ApiError, cancelUpload } from "@/lib/api";
import {
  isAbortError,
  runPool,
  uploadFile,
  type UploadResult,
} from "@/lib/upload-file";

export type UploadStatus =
  | "queued"
  | "uploading"
  | "completed"
  | "error"
  | "canceled";

export type UploadItem = {
  id: string;
  file: File;
  status: UploadStatus;
  uploadedBytes: number;
  result?: UploadResult;
  error?: string;
};

/** Jumlah file yang diunggah bersamaan (tiap file juga mengirim chunk paralel). */
const FILE_CONCURRENCY = 2;

let seq = 0;
const nextId = () => `upload-${++seq}`;

export function useUploads(chunkSize: number) {
  const [items, setItems] = useState<UploadItem[]>([]);

  // Data yang dibutuhkan proses async; disimpan di ref agar tidak bergantung
  // pada snapshot state yang mungkin sudah usang.
  const controllers = useRef(new Map<string, AbortController>());
  const serverIds = useRef(new Map<string, string>());
  const canceled = useRef(new Set<string>());

  const patch = useCallback((id: string, changes: Partial<UploadItem>) => {
    setItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, ...changes } : it)),
    );
  }, []);

  const cancelOnServer = useMutation({
    mutationFn: cancelUpload,
  });

  const upload = useMutation({
    mutationFn: async (item: UploadItem) => {
      const controller = new AbortController();
      controllers.current.set(item.id, controller);
      patch(item.id, { status: "uploading", error: undefined });
      try {
        return await uploadFile(item.file, {
          chunkSize,
          signal: controller.signal,
          resumeId: serverIds.current.get(item.id),
          onStarted: (uploadId) => {
            // Dibatalkan tepat saat init selesai: langsung bersihkan di server.
            if (canceled.current.has(item.id)) cancelOnServer.mutate(uploadId);
            else serverIds.current.set(item.id, uploadId);
          },
          onProgress: (uploadedBytes) => patch(item.id, { uploadedBytes }),
        });
      } finally {
        controllers.current.delete(item.id);
      }
    },
    // Callback level useMutation dipanggil untuk setiap pemanggilan mutate,
    // jadi aman untuk banyak file yang berjalan bersamaan.
    onSuccess: (result, item) => {
      patch(item.id, {
        status: "completed",
        result,
        uploadedBytes: item.file.size,
      });
    },
    onError: (error, item) => {
      if (isAbortError(error) || canceled.current.has(item.id)) return;
      patch(item.id, { status: "error", error: errorMessage(error) });
    },
  });

  const start = (item: UploadItem) =>
    upload.mutateAsync(item).catch(() => {
      /* status error sudah dicatat di onError */
    });

  const enqueue = (files: File[]) => {
    const added: UploadItem[] = files.map((file) => ({
      id: nextId(),
      file,
      status: "queued",
      uploadedBytes: 0,
    }));
    setItems((prev) => [...prev, ...added]);
    void runPool(added, FILE_CONCURRENCY, async (item) => {
      if (canceled.current.has(item.id)) return;
      await start(item);
    });
  };

  const cancel = (item: UploadItem) => {
    canceled.current.add(item.id);
    controllers.current.get(item.id)?.abort();
    patch(item.id, { status: "canceled", error: undefined });

    const uploadId = serverIds.current.get(item.id);
    if (uploadId) {
      serverIds.current.delete(item.id);
      cancelOnServer.mutate(uploadId);
    }
  };

  const retry = (item: UploadItem) => {
    canceled.current.delete(item.id);
    patch(item.id, { status: "queued", error: undefined });
    void start(item);
  };

  const remove = (item: UploadItem) => {
    if (item.status === "uploading" || item.status === "queued") cancel(item);
    serverIds.current.delete(item.id);
    setItems((prev) => prev.filter((it) => it.id !== item.id));
  };

  const clearFinished = () => {
    setItems((prev) =>
      prev.filter((it) => it.status === "uploading" || it.status === "queued"),
    );
  };

  const isBusy = items.some(
    (it) => it.status === "uploading" || it.status === "queued",
  );

  // Peringatkan pengguna sebelum menutup tab saat upload masih berjalan.
  useEffect(() => {
    if (!isBusy) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isBusy]);

  // Hentikan semua request yang masih berjalan saat komponen dilepas.
  useEffect(() => {
    const active = controllers.current;
    return () => active.forEach((c) => c.abort());
  }, []);

  return { items, isBusy, enqueue, cancel, retry, remove, clearFinished };
}

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof TypeError) return "Tidak dapat terhubung ke server";
  return "Terjadi kesalahan yang tidak terduga";
}
