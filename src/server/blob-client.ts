// The Blob calls the server makes, each with BLOB_DEADLINE_MS to answer. The SDK retries a failing call with growing
// waits for many minutes and stops early only on an abort error named "AbortError", so in an outage a plain call would
// hold a route until its function is stopped. Here a call that has not answered in time is aborted with that error, and
// its promise rejects at the deadline even while the SDK waits between retries, so the route can answer that it is
// unavailable (the director's answer has its own deadline, and falls back to the rules). A small JSON blob is read
// whole within the deadline (blobGetText); for a stream (a sprite) the deadline is off once the call has answered, so a
// body still on its way is not cut.
import { get, head, list, put } from "@vercel/blob";

const BLOB_DEADLINE_MS = 10_000;

/** Raised when a Blob call does not answer within the deadline. */
export class BlobDeadlineError extends Error {
  override name = "BlobDeadlineError";
}

/** Runs `call` with the deadline, and stops it when `signal` aborts (the job it belongs to has ended, say). */
export function withinDeadline<Result>(
  call: (abortSignal: AbortSignal) => Promise<Result>,
  signal?: AbortSignal,
  deadlineMilliseconds = BLOB_DEADLINE_MS,
): Promise<Result> {
  return new Promise<Result>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const controller = new AbortController();
    const settle = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    const stop = (reason: unknown) => {
      settle();
      controller.abort(new DOMException("the Blob call was stopped", "AbortError"));
      reject(reason);
    };
    const onAbort = () => stop(signal?.reason);
    const timer = setTimeout(
      () => stop(new BlobDeadlineError(`no answer in ${deadlineMilliseconds} ms`)),
      deadlineMilliseconds,
    );
    signal?.addEventListener("abort", onAbort, { once: true });
    // started in a then, so a call that throws at once still settles here and clears the timer
    Promise.resolve()
      .then(() => (controller.signal.aborted ? Promise.reject(controller.signal.reason) : call(controller.signal)))
      .then(
        (result) => {
          settle();
          resolve(result);
        },
        (error: unknown) => {
          settle();
          reject(error);
        },
      );
  });
}

type PutOptions = Omit<Parameters<typeof put>[2], "abortSignal">;
type GetOptions = Omit<Parameters<typeof get>[1], "abortSignal">;

export const blobPut = (pathname: string, body: Parameters<typeof put>[1], options: PutOptions, signal?: AbortSignal) =>
  withinDeadline((abortSignal) => put(pathname, body, { ...options, abortSignal }), signal);

export const blobGet = (pathname: string, options: GetOptions) =>
  withinDeadline((abortSignal) => get(pathname, { ...options, abortSignal }));

/** The text of a small blob and its version (the ETag), read whole within the deadline, or null when there is none. */
export const blobGetText = (pathname: string, options: GetOptions) =>
  withinDeadline(async (abortSignal) => {
    const blob = await get(pathname, { ...options, abortSignal });
    if (blob?.statusCode !== 200) return null;
    return { text: await new Response(blob.stream).text(), version: blob.blob.etag };
  });

export const blobHead = (pathname: string) => withinDeadline((abortSignal) => head(pathname, { abortSignal }));

export const blobList = (options: { prefix: string; cursor?: string }) =>
  withinDeadline((abortSignal) => list({ ...options, abortSignal }));
