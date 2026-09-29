import { DevTableStates } from "@/dev/DevTableStates";

/**
 * Development only: the `.dev.tsx` extension is a page only under `next dev`
 * (see pageExtensions in next.config.ts), so production builds leave it out.
 */
export default async function TableStatesPage({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  const { state } = await searchParams;
  return <DevTableStates state={state} />;
}
