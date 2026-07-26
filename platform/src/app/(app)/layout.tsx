import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import Sidebar from "./Sidebar";
import s from "./shell.module.css";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  return (
    <div className={s.shell}>
      <Sidebar name={user.name} role={user.role} />
      <main className={s.main}>{children}</main>
    </div>
  );
}
