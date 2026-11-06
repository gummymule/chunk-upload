import { Suspense } from "react";
import { Uploader, UploaderSkeleton } from "@/components/upload/uploader";

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-12 sm:py-16">
      <header className="mb-8 flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Unggah File</h1>
        <p className="text-zinc-500">
          File dipecah menjadi beberapa bagian dan dikirim bertahap, jadi
          unggahan yang gagal bisa dilanjutkan tanpa mengulang dari awal.
        </p>
      </header>

      {/* Dengan cacheComponents, komponen client ikut di-prerender; useQuery
          perlu berada di balik Suspense. */}
      <Suspense fallback={<UploaderSkeleton />}>
        <Uploader />
      </Suspense>
    </main>
  );
}
