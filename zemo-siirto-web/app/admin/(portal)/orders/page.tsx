import type { Metadata } from "next";
import { AutoRefresh, GotoSelect } from "@/components/client";
import { Flash } from "@/components/ui";
import { STATUS_LABEL, type Status } from "@/lib/domain";
import { one, requireAdmin, type SearchParams } from "@/lib/state";
import { OrdersTable } from "../orders-table";

export const metadata: Metadata = { title: "Orders" };

export default async function Orders({ searchParams }: { searchParams: SearchParams }) {
  const { s } = await requireAdmin();
  const sp = await searchParams;
  const status = one(sp.status);
  const list = [...s.orders].reverse().filter(o => !status || o.status === status);
  const here = status ? `/admin/orders?status=${status}` : "/admin/orders";
  return <>
    <AutoRefresh />
    <Flash sp={sp} />
    <div className="card">
      <div className="row"><h1 className="m0">Orders</h1><span className="spacer" />
        <div className="filter"><GotoSelect label="Filter by status" value={here}
          options={[["/admin/orders", "All statuses"], ...(Object.keys(STATUS_LABEL) as Status[]).map(k => [`/admin/orders?status=${k}`, STATUS_LABEL[k]] as [string, string])]} /></div></div>
      <div className="mt"><OrdersTable s={s} list={list} from={here} /></div>
    </div>
  </>;
}
