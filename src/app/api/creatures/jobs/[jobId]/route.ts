// GET /api/creatures/jobs/:jobId: where a generation job is. A job that has not moved for longer than the routes'
// maxDuration reads as failed (src/server/creatures/service.ts).
import { ignore } from "@/lib/ignore";
import { createServiceDeps } from "@/server/creatures/deps";
import { readJob } from "@/server/creatures/service";

const JOB_ID = /^[a-z0-9-]{8,64}$/;

export async function GET(_request: Request, context: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await context.params;
  if (!JOB_ID.test(jobId)) {
    return Response.json({ error: "bad id" }, { status: 400 });
  }
  try {
    const job = await readJob(createServiceDeps(ignore), jobId);
    if (!job) {
      return Response.json({ error: "not found" }, { status: 404, headers: { "cache-control": "no-store" } });
    }
    return Response.json(job, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ error: "unavailable" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
