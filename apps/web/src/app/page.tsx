import { CreateTable, JoinTable } from "@/components/CreateTable";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-8 safe-bottom">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">
          Garage<span className="text-gold">Poker</span>
        </h1>
        <p className="text-muted">
          Private poker tables for your home game. Pick a game, create the table, send your friends the link. No accounts,
          no real money, no paywall.
        </p>
      </header>

      <section className="rounded-2xl border border-line bg-panel p-4 sm:p-6">
        <h2 className="text-lg font-semibold">Create a private table</h2>
        <p className="mb-4 text-xs text-muted">Only people you send the link to can find it.</p>
        <CreateTable />
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-muted">Have a link?</h2>
        <JoinTable />
      </section>
    </main>
  );
}
