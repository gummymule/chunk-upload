"use client";

import { useMemo } from "react";
import { useController, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useDropzone } from "react-dropzone";
import type { UploadConfig } from "@/lib/api";
import { formatBytes } from "@/lib/format";
import { createUploadSchema, MAX_FILES } from "@/lib/upload-schema";

const fileKey = (f: File) => `${f.name}:${f.size}:${f.lastModified}`;

type Props = {
  config: UploadConfig;
  onSubmit: (files: File[]) => void;
};

export function UploadForm({ config, onSubmit }: Props) {
  const schema = useMemo(() => createUploadSchema(config), [config]);
  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: { files: [] },
    mode: "onChange",
  });
  const { field } = useController({ control: form.control, name: "files" });
  const files = field.value;
  const errors = form.formState.errors.files;

  const addFiles = (incoming: File[]) => {
    const seen = new Set(files.map(fileKey));
    const fresh = incoming.filter((f) => !seen.has(fileKey(f)));
    if (fresh.length > 0) field.onChange([...files, ...fresh]);
  };

  const removeAt = (index: number) =>
    field.onChange(files.filter((_, i) => i !== index));

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: addFiles,
    multiple: true,
  });

  const submit = form.handleSubmit(({ files }) => {
    onSubmit(files);
    form.reset({ files: [] });
  });

  const totalSize = files.reduce((sum, f) => sum + f.size, 0);
  const listError = errors?.message ?? errors?.root?.message;

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <div
        {...getRootProps({
          className: [
            "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-12 text-center transition-colors",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500",
            isDragActive
              ? "border-blue-500 bg-blue-50 dark:bg-blue-950/30"
              : "border-zinc-300 hover:border-zinc-400 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:border-zinc-600 dark:hover:bg-zinc-900",
          ].join(" "),
        })}
      >
        <input {...getInputProps({ name: field.name, onBlur: field.onBlur })} />
        <UploadIcon />
        <p className="font-medium">
          {isDragActive
            ? "Lepaskan file di sini"
            : "Seret file ke sini, atau klik untuk memilih"}
        </p>
        <p className="text-sm text-zinc-500">
          Maks. {MAX_FILES} file, masing-masing hingga{" "}
          {formatBytes(config.maxFileSize)}
        </p>
      </div>

      {files.length > 0 && (
        <ul className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {files.map((file, i) => {
            const message = errors?.[i]?.message;
            return (
              <li key={fileKey(file)} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium" title={file.name}>
                    {file.name}
                  </p>
                  <p
                    className={`text-xs ${message ? "text-red-600 dark:text-red-400" : "text-zinc-500"}`}
                  >
                    {message ?? formatBytes(file.size)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => removeAt(i)}
                  className="rounded-md px-2 py-1 text-sm text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                  aria-label={`Hapus ${file.name}`}
                >
                  Hapus
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {listError && (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {listError}
        </p>
      )}

      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-zinc-500">
          {files.length > 0
            ? `${files.length} file dipilih · ${formatBytes(totalSize)}`
            : "Belum ada file dipilih"}
        </p>
        <div className="flex gap-2">
          {files.length > 0 && (
            <button
              type="button"
              onClick={() => form.reset({ files: [] })}
              className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Kosongkan
            </button>
          )}
          <button
            type="submit"
            disabled={files.length === 0}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            Unggah
          </button>
        </div>
      </div>
    </form>
  );
}

function UploadIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className="h-10 w-10 text-zinc-400"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5"
      />
    </svg>
  );
}
