import type { Metadata } from "next";
import { PortalShell } from "@/components/shell";
import { requireAdmin } from "@/lib/state";

export const metadata: Metadata = { robots: { index: false } };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireAdmin();
  return <PortalShell portal="admin" name={user.email}>{children}</PortalShell>;
}
