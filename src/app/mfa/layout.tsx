import { AccountMenu } from "@/components/auth/account-menu";
import { InactivityGuard } from "@/components/auth/inactivity-guard";
import { requirePageAccess } from "@/lib/auth/session";

export default async function MfaLayout({ children }: { children: React.ReactNode }) {
  await requirePageAccess({ needProfile: false, skipMfa: true, nextPath: "/mfa/verify" });
  return (
    <>
      <div className="fixed top-0 right-0 z-40 p-4">
        <AccountMenu />
      </div>
      {children}
      <InactivityGuard />
    </>
  );
}
