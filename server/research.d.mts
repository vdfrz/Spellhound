import type { IncomingMessage, ServerResponse } from "node:http";
export function researchRoute(config: {origin: string}): (req: IncomingMessage, res: ServerResponse) => Promise<void>;
