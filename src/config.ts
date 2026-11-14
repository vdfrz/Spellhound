const origin = typeof window === "undefined" ? "" : window.location.origin;

declare const __APP_VERSION__: string;
const appVersion = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "0.0.0";

export const config = {
  apiBase: origin,
  appBase: origin,
  appVersion,
  // The add-in is served from its own origin; derive it rather than configure it.
  addinOrigin: typeof window !== "undefined" ? window.location.origin : "",
} as const;

export function assertConfigured(): void {
  if (!config.addinOrigin) throw new Error("Missing Word add-in origin.");
}
