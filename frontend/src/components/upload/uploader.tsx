"use client";

import { useQuery } from "@tanstack/react-query";
import { getConfig, type UploadConfig } from "@/lib/api";
import { useUploads } from "@/hooks/use-uploads";
import { UploadForm } from "./upload-form";
import { UploadList } from "./upload-list";

export function Uploader() {
  const config = useQuery({
    queryKey: ["upload-config"],
    queryFn: ({ signal }) => getConfig(signal),
    staleTime: Infinity,
  });

  if (config.isPending) return <UploaderSkeleton />;

  if (config.isError) {
    return (
      <div className="flex flex-col items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm dark:border-red-900 dark:bg-red-950/30">
        <p className="text-red-700 dark:text-red-300">
          Gagal memuat konfigurasi upload dari server. Pastikan backend
          berjalan.
        </p>
        <button
          type="button"
          onClick={() => config.refetch()}
          className="rounded-lg bg-red-600 px-3 py-1.5 font-medium text-white hover:bg-red-700"
        >
          Coba lagi
        </button>
      </div>
    );
  }

  return <UploadPanel config={config.data} />;
}

function UploadPanel({ config }: { config: UploadConfig }) {
  const uploads = useUploads(config.chunkSize);

  return (
    <div className="flex flex-col gap-10">
      <UploadForm config={config} onSubmit={uploads.enqueue} />
      <UploadList
        items={uploads.items}
        onCancel={uploads.cancel}
        onRetry={uploads.retry}
        onRemove={uploads.remove}
        onClearFinished={uploads.clearFinished}
      />
    </div>
  );
}

export function UploaderSkeleton() {
  return (
    <div
      className="h-48 animate-pulse rounded-xl border-2 border-dashed border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900"
      aria-label="Memuat"
    />
  );
}
