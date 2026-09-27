import { notFound } from "next/navigation";
import { TableClient } from "@/components/table/TableClient";
import { TABLE_ID } from "@/lib/server";

export default async function TablePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!TABLE_ID.test(id)) notFound();
  return <TableClient tableId={id} />;
}
