import { PortalShell } from "@/components/shell";
import { requireCustomer } from "@/lib/state";

export default async function CustomerLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireCustomer();
  return <PortalShell portal="customer" name={user.name}>{children}</PortalShell>;
}
