import { PwaStartScreen } from "@/components/pwa/pwa-start-screen";

/**
 * PWA start_url and marketing entry.
 * First paint is a local branded splash (no server auth/profile await).
 * Session restore + redirect run on the client with a bounded budget.
 */
export default function Home() {
  return <PwaStartScreen />;
}
