import TrainingSystem from "./components/training-system";
import { requirePageAccount } from "../lib/access-control";

export const dynamic = "force-dynamic";

export default async function Home() {
  const account = await requirePageAccount("/");
  return <TrainingSystem account={account} />;
}
