import { isCommunity } from "./edition";

/**
 * Edition gating helpers for the UI.
 *
 * The request shim (localRouter) already gates BEHAVIOR: any feature that needs
 * Spellhound's hosted data or account throws REQUIRES_ACCOUNT. These helpers let the
 * UI gate PRESENTATION too, so the community build hides account-only surfaces
 * (usage/quota, org switcher) rather than showing something that would only error.
 */
export const REQUIRES_ACCOUNT_NOTE = "Requires a Spellhound account";

/** Surfaces that only make sense with a hosted Spellhound account. */
export function showsAccountSurfaces(): boolean {
  return !isCommunity();
}
