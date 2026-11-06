"use client";

import { fileUrl } from "@/lib/api";
import { formatBytes } from "@/lib/format";
import type { UploadItem, UploadStatus } from "@/hooks/use-uploads";

const STATUS_LABEL: Record<UploadStatus, string> = {
  queued: "Menunggu",
  uploading: "Mengunggah",
  completed: "Selesai",
  error: "Gagal",
  canceled: "Dibatalkan",
};

const BAR_COLOR: Record<UploadStatus, string> = {
  queued: "bg-zinc-300 dark:bg-zinc-700",
  uploading: "bg-blue-500",
  completed: "bg-emerald-500",
  error: "bg-red-500",
  canceled: "bg-zinc-400 dark:bg-zinc-600",
};

type Props = {
  items: UploadItem[];
  onCancel: (item: UploadItem) => void;
  onRetry: (item: UploadItem) => void;
  onRemove: (item: UploadItem) => void;
  onClearFinished: () => void;
};

export function UploadList({
  items,
  onCancel,
  onRetry,
  onRemove,
  onClearFinished,
}: Props) {
  if (items.length === 0) return null;
  const hasFinished = items.some(
    (it) => it.status !== "uploading" && it.status !== "queued",
  );

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Daftar unggahan
        </h2>
        {hasFinished && (
          <button
            type="button"
            onClick={onClearFinished}
            className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            Bersihkan yang selesai
          </button>
        )}
      </div>

      <ul className="flex flex-col gap-2">
        {items.map((item) => (
          <UploadRow
            key={item.id}
            item={item}
            onCancel={onCancel}
            onRetry={onRetry}
            onRemove={onRemove}
          />
        ))}
      </ul>
    </section>
  );
}

function UploadRow({
  item,
  onCancel,
  onRetry,
  onRemove,
}: {
  item: UploadItem;
  onCancel: (item: UploadItem) => void;
  onRetry: (item: UploadItem) => void;
  onRemove: (item: UploadItem) => void;
}) {
  const { file, status } = item;
  const percent = Math.round((item.uploadedBytes / file.size) * 100);
  const active = status === "uploading" || status === "queued";

  return (
    <li className="rounded-xl border border-zinc-200 px-4 py-3 dark:border-zinc-800">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" title={file.name}>
            {file.name}
          </p>
          <p className="text-xs text-zinc-500">
            {status === "uploading"
              ? `${formatBytes(item.uploadedBytes)} / ${formatBytes(file.size)}`
              : formatBytes(file.size)}
            {" · "}
            <span
              className={
                status === "error"
                  ? "text-red-600 dark:text-red-400"
                  : status === "completed"
                    ? "text-emerald-600 dark:text-emerald-400"
                    : undefined
              }
            >
              {STATUS_LABEL[status]}
              {status === "uploading" && ` ${percent}%`}
            </span>
          </p>
        </div>

        <div className="flex shrink-0 gap-1">
          {status === "completed" && item.result && (
            <a
              href={fileUrl(item.result.fileId)}
              className="rounded-md px-2 py-1 text-sm font-medium text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/40"
            >
              Unduh
            </a>
          )}
          {(status === "error" || status === "canceled") && (
            <RowButton onClick={() => onRetry(item)}>Ulangi</RowButton>
          )}
          {active ? (
            <RowButton onClick={() => onCancel(item)}>Batal</RowButton>
          ) : (
            <RowButton onClick={() => onRemove(item)}>Hapus</RowButton>
          )}
        </div>
      </div>

      <div
        className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800"
        role="progressbar"
        aria-label={`Progres ${file.name}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <div
          className={`h-full rounded-full transition-[width] duration-300 ${BAR_COLOR[status]}`}
          style={{ width: `${status === "completed" ? 100 : percent}%` }}
        />
      </div>

      {status === "error" && item.error && (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400">{item.error}</p>
      )}
      {status === "completed" && item.result?.sha256 && (
        <p
          className="mt-2 truncate font-mono text-xs text-zinc-400"
          title={item.result.sha256}
        >
          SHA-256 {item.result.sha256}
        </p>
      )}
    </li>
  );
}

function RowButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md px-2 py-1 text-sm text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
    >
      {children}
    </button>
  );
}
