"use client";
import { useRouter } from "next/navigation";

export default function LogoutButton() {
  const router = useRouter();
  return (
    <button
      style={{ display: "block", marginTop: 8, fontSize: 12, padding: "4px 8px" }}
      onClick={async () => {
        await fetch("/api/auth/logout", { method: "POST" });
        router.push("/login");
      }}
    >
      Sign out
    </button>
  );
}
