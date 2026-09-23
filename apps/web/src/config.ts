export interface AppConfig {
  auth: { publishableKey: string } | undefined;
}

export function readConfig(): AppConfig {
  const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;

  return { auth: publishableKey ? { publishableKey } : undefined };
}
