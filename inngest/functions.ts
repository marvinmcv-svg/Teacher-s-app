import { inngest } from "./client";

/**
 * Wiring check only (Phase 0): proves the Inngest endpoint is registered and
 * steps run. The grading pipeline (`submission.grade`, §8.1) arrives in Phase 1.
 */
export const ping = inngest.createFunction(
  { id: "system-ping", triggers: [{ event: "tinta/system.ping" }] },
  async ({ event, step }) => {
    const receivedAt = await step.run("record", () => new Date().toISOString());
    return { ok: true, receivedAt, eventId: event.id ?? null };
  },
);

export const functions = [ping];
