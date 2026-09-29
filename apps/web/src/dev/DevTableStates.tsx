"use client";

import Link from "next/link";
import { TableScreen } from "@/components/table/TableScreen";
import { DEV_NOW, DEV_STATES } from "./tableStates";

/** One mocked state full screen (?state=b), or the list of states. Messages go to the console. */
export function DevTableStates({ state }: { state: string | undefined }) {
  const found = DEV_STATES.find((s) => s.id === state);
  if (!found) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-col gap-2 p-6">
        <h1 className="mb-2 text-lg font-semibold">Table states (dev only)</h1>
        {DEV_STATES.map((s) => (
          <Link key={s.id} href={`?state=${s.id}`} className="rounded-lg border border-line bg-panel px-3 py-2 hover:bg-panel-2">
            <span className="mr-2 font-mono text-gold">{s.id}</span>
            {s.title}
          </Link>
        ))}
      </main>
    );
  }
  return (
    <TableScreen
      key={found.id}
      view={found.view}
      now={DEV_NOW}
      send={(m) => console.log("[dev] send", m)}
      initialRaising={found.raising}
    />
  );
}
