export interface Org {
  id: string;
  name: string;
  role?: string | null;
}

// No organization service in the installation-only pilot.
export async function listMyOrganizations(): Promise<Org[]> { return []; }
