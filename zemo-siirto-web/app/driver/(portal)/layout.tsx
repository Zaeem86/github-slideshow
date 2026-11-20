import { PortalShell } from "@/components/shell";
import { requireDriver } from "@/lib/state";

export default async function DriverLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireDriver();
  return <PortalShell portal="driver" name={user.name}>{children}</PortalShell>;
}
