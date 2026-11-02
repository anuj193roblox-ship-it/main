import Link from "next/link";
import { getSessionState } from "@/lib/auth/session";
import { AccountMenu } from "./account-menu";

/** Top-right corner: "Log in" when signed out, the account menu when signed in. */
export async function CornerAccount() {
  const state = await getSessionState();
  return (
    <div className="fixed top-0 right-0 z-40 p-4">
      {state.user ? (
        <AccountMenu />
      ) : (
        <Link
          href="/login?next=/app/today"
          className="inline-flex min-h-12 items-center rounded-input bg-primary px-5 font-medium text-white hover:bg-primary-pressed focus:outline-2 focus:outline-offset-2 focus:outline-primary"
        >
          Log in
        </Link>
      )}
    </div>
  );
}
