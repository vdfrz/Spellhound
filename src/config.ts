const origin = typeof window === "undefined" ? "" : window.location.origin;

declare const __APP_VERSION__: string;
const appVersion = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "0.0.0";

export const config = {
  apiBase: origin,
  appBase: origin,
  appVersion,
  // Where a new user registers. There is no sign-up inside Word (by design): the
  // login screen sends people here to create an account, then they sign in.
  signupUrl: `${origin}/auth/signup`,
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL ?? "",
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY ?? "",
  // The add-in is served from its own origin; derive it rather than configure it.
  addinOrigin: typeof window !== "undefined" ? window.location.origin : "",
} as const;

/** URL of the PKCE redirect page opened inside the Office auth dialog. */
export const authRedirectUrl = `${config.addinOrigin}/auth.html`;

export function assertConfigured(): void {
  if (!config.addinOrigin) throw new Error("Missing Word add-in origin.");
}
