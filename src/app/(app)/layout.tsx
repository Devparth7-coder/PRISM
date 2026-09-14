import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { AppChrome } from "@/components/shell/AppChrome";
import { ReviewContextProvider } from "@/components/shell/ReviewContext";
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const user = currentUser();
  if (!user) redirect("/login?next=/dashboard");
  return (
    <ReviewContextProvider>
      <AppChrome user={{ login: user.login, name: user.name, isDemo: user.isDemo }} mode={config.mode}>
        {children}
      </AppChrome>
    </ReviewContextProvider>
  );
}
