"use client";

import { LogOut } from "lucide-react";

export function LogoutButton() {
  return (
    <button
      onClick={async () => {
        await fetch("/api/auth/logout", { method: "POST" });
        window.location.href = "/";
      }}
      className="btn-secondary h-8 text-xs"
    >
      <LogOut className="h-3.5 w-3.5" /> Sign out
    </button>
  );
}
