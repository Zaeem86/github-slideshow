import { DriverShell } from "@/components/driver/shell";
import { requireDriver } from "@/lib/state";

export default async function DriverLayout({ children }: { children: React.ReactNode }) {
  const { s, user } = await requireDriver();
  // Trips in progress: GPS stays on and the position is sent for these orders.
  const driving = s.orders.filter(o => o.driverId === user.id && o.status === "in_transit").map(o => o.uuid);
  return <DriverShell driving={driving}>{children}</DriverShell>;
}
