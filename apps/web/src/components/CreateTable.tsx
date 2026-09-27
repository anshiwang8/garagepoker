"use client";

import { DEFAULT_SETTINGS, type TableSettings } from "@garagepoker/engine";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createTable, TABLE_ID } from "@/lib/server";
import { getPlayerToken } from "@/lib/token";
import { SettingsForm } from "./SettingsForm";
import { Button, inputClass } from "./ui";

export function CreateTable() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async (settings: TableSettings) => {
    setBusy(true);
    setError(null);
    try {
      const id = await createTable(getPlayerToken(), settings);
      router.push(`/t/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create the table");
      setBusy(false);
    }
  };

  return (
    <SettingsForm
      initial={DEFAULT_SETTINGS}
      submitLabel="Create table"
      onSubmit={create}
      busy={busy}
      footer={
        error && <p className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>
      }
    />
  );
}

/** Paste a table link or its 10-character code. */
export function JoinTable() {
  const router = useRouter();
  const [text, setText] = useState("");
  const id = text.trim().split("/").filter(Boolean).at(-1) ?? "";
  const valid = TABLE_ID.test(id);
  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) router.push(`/t/${id}`);
      }}
    >
      <input
        className={inputClass}
        placeholder="Table link or code"
        value={text}
        onChange={(e) => setText(e.target.value)}
        aria-label="Table link or code"
      />
      <Button type="submit" disabled={!valid}>
        Join
      </Button>
    </form>
  );
}

