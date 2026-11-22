import { redirect } from "next/navigation";
import { one, type SearchParams } from "@/lib/state";
export default async function Old({ searchParams }: { searchParams: SearchParams }) {
  const id = one((await searchParams).order);
  redirect(id ? `/driver/map?order=${encodeURIComponent(id)}` : "/driver/my-jobs");
}
