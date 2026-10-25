import { describe, expect, test } from "bun:test";
import { BlobDeadlineError, withinDeadline } from "./blob-client";

// a Blob call that never answers, as in an outage, and keeps the signal it was given
function hangingCall() {
  const seen: { signal: AbortSignal | null } = { signal: null };
  const call = (abortSignal: AbortSignal) => {
    seen.signal = abortSignal;
    return new Promise<string>(() => {});
  };
  return { seen, call };
}

describe("a Blob call within the deadline", () => {
  test("rejects at the deadline, and aborts the SDK's call with the error that stops its retries", async () => {
    const { seen, call } = hangingCall();
    const startedAt = Date.now();
    await expect(withinDeadline(call, undefined, 20)).rejects.toBeInstanceOf(BlobDeadlineError);
    expect(Date.now() - startedAt).toBeLessThan(1000);
    expect(seen.signal?.aborted).toBe(true);
    expect(seen.signal?.reason).toBeInstanceOf(DOMException);
    expect(seen.signal?.reason).toMatchObject({ name: "AbortError" });
  });

  test("stops when the job it belongs to ends, with the job's reason", async () => {
    const { seen, call } = hangingCall();
    const job = new AbortController();
    const running = withinDeadline(call, job.signal, 10_000);
    await new Promise((resolve) => setTimeout(resolve, 0)); // the call is on its way
    job.abort(new Error("timed out"));
    await expect(running).rejects.toThrow("timed out");
    expect(seen.signal?.aborted).toBe(true);
  });

  test("does not start once the job has ended", async () => {
    const { seen, call } = hangingCall();
    const job = new AbortController();
    job.abort(new Error("timed out"));
    await expect(withinDeadline(call, job.signal, 10_000)).rejects.toThrow("timed out");
    expect(seen.signal).toBeNull();
  });

  test("an answer in time is kept, and nothing is aborted after it", async () => {
    const given: AbortSignal[] = [];
    const answer = await withinDeadline(
      async (abortSignal) => {
        given.push(abortSignal);
        return "stored";
      },
      undefined,
      20,
    );
    expect(answer).toBe("stored");
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(given.map((signal) => signal.aborted)).toEqual([false]);
  });

  test("settles and clears its deadline when the call throws at once", async () => {
    const given: AbortSignal[] = [];
    const throwing = (abortSignal: AbortSignal) => {
      given.push(abortSignal);
      throw new Error("bad options");
    };
    await expect(withinDeadline(throwing, undefined, 20)).rejects.toThrow("bad options");
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(given.map((signal) => signal.aborted)).toEqual([false]); // the deadline did not fire after it
  });
});
