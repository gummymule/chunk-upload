import { z } from "zod";
import type { UploadConfig } from "./api";
import { formatBytes } from "./format";

export const MAX_FILES = 10;

const encoder = new TextEncoder();

/**
 * Skema form upload. Batas ukuran diambil dari GET /api/config supaya
 * selalu sama dengan validasi di backend.
 */
export function createUploadSchema({ maxFileSize }: UploadConfig) {
  return z.object({
    files: z
      .array(
        z
          .instanceof(File)
          .refine((f) => f.size > 0, "File kosong tidak bisa diunggah")
          .refine(
            (f) => f.size <= maxFileSize,
            `Melebihi batas ${formatBytes(maxFileSize)}`,
          )
          .refine((f) => {
            // Backend membatasi panjang nama dalam byte, bukan karakter.
            const name = f.name.trim();
            return name.length > 0 && encoder.encode(name).length <= 255;
          }, "Nama file terlalu panjang"),
      )
      .min(1, "Pilih minimal satu file")
      .max(MAX_FILES, `Maksimal ${MAX_FILES} file sekali unggah`),
  });
}

export type UploadFormValues = z.infer<ReturnType<typeof createUploadSchema>>;
