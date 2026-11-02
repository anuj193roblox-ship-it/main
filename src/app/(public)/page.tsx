import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-[420px] flex-1 flex-col justify-center gap-6 px-6 pt-24 pb-12">
      <div className="space-y-3">
        <h1 className="text-[28px] leading-9 font-bold">Nurra</h1>
        <p className="text-lg leading-7">
          Dementia takes away independence one forgotten routine at a time. Nurra gently guides the day and tells the
          family only when it matters.
        </p>
      </div>
      <Link
        href="/signup"
        className="inline-flex min-h-12 w-full items-center justify-center rounded-input bg-primary px-4 font-medium text-white hover:bg-primary-pressed focus:outline-2 focus:outline-offset-2 focus:outline-primary"
      >
        Create an account
      </Link>
    </main>
  );
}
