import { CornerAccount } from "@/components/auth/corner-account";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <CornerAccount />
      {children}
    </>
  );
}
