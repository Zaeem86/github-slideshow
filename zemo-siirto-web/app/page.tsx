import { HomeView } from "@/components/home";
import { getStateOrDefaults, settingsOf } from "@/lib/state";

export default async function Home() {
  // Prices come from the admin's pricing settings in the database.
  const settings = settingsOf(await getStateOrDefaults());
  return <HomeView settings={settings} />;
}
