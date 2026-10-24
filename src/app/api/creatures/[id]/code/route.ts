// GET /api/creatures/:id/code: the build code that draws a gallery creature, as text, cached for good
// (src/server/creatures/code.ts).
import { codeResponse } from "@/server/creatures/code";
import { createServiceDeps } from "@/server/creatures/deps";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return codeResponse(createServiceDeps(() => {}).store, id);
}
