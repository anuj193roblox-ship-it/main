import { TabBar } from "@/components/app/tab-bar";
import { AccountMenu } from "@/components/auth/account-menu";
import { InactivityGuard } from "@/components/auth/inactivity-guard";
import { requirePageAccess } from "@/lib/auth/session";

// Signed-in area. The proxy has already checked the session; this checks it again on the server.
// Each page checks once more for what it needs (household, two-step sign-in, role).
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { profile } = await requirePageAccess({ needProfile: false, skipMfa: true, nextPath: "/app/today" });
  return (
    <>
      <header className="flex items-center justify-between border-b border-line px-4 py-2">
        <span className="text-xl leading-7 font-bold text-primary">Nurra</span>
        <AccountMenu />
      </header>
      <div className="flex flex-1 flex-col pb-20">{children}</div>
      {profile && <TabBar />}
      <InactivityGuard />
    </>
  );
}
