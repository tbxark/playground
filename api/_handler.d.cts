import type { IncomingMessage, ServerResponse } from "node:http";

declare function handler(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void>;

export default handler;
