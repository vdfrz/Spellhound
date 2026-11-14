import { hosted, paymentSettings } from "@/auth/publik";
import { Button } from "@/ui/primitives";
import { ProviderKeyForm } from "@/features/onboarding/ProviderKeyForm";

/**
 * Settings card for the community edition: change provider, model, or key at any
 * time. Rendered only in the community build (see SettingsView).
 */
export function AiProvidersCard() {
  return (
    <div className="card settings-card">
      <h2 className="settings-heading">AI provider</h2>
      <p className="small muted settings-heading__hint">
        {hosted ? "Use your Publik balance or configure your own provider." : "Configure your AI provider on this device."}
      </p>
      {hosted ? <Button onClick={paymentSettings}>Change AI payment or key</Button> : <ProviderKeyForm ownOnly />}
    </div>
  );
}
