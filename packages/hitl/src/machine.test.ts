import { describe, it, expect } from "vitest";
import { createActor } from "xstate";
import { hitlMachine } from "./machine.js";

describe("hitlMachine", () => {
  const ctx = { taskId: "t1", agentId: "a1", reviewRequired: false };

  it("starts in IDLE", () => {
    const actor = createActor(hitlMachine, { input: ctx });
    actor.start();
    expect(actor.getSnapshot().value).toBe("IDLE");
    actor.stop();
  });

  it("transitions IDLE → RUNNING on START", () => {
    const actor = createActor(hitlMachine, { input: ctx });
    actor.start();
    actor.send({ type: "START" });
    expect(actor.getSnapshot().value).toBe("RUNNING");
    actor.stop();
  });

  it("goes to DONE when RESULT_READY and no review required", () => {
    const actor = createActor(hitlMachine, { input: ctx });
    actor.start();
    actor.send({ type: "START" });
    actor.send({ type: "RESULT_READY", requiresReview: false });
    expect(actor.getSnapshot().value).toBe("DONE");
    actor.stop();
  });

  it("goes to AWAITING_HUMAN when RESULT_READY and review required", () => {
    const reviewCtx = { ...ctx, reviewRequired: true };
    const actor = createActor(hitlMachine, { input: reviewCtx });
    actor.start();
    actor.send({ type: "START" });
    actor.send({ type: "RESULT_READY", requiresReview: true });
    expect(actor.getSnapshot().value).toBe("AWAITING_HUMAN");
    actor.stop();
  });

  it("escalates on TIMEOUT", () => {
    const reviewCtx = { ...ctx, reviewRequired: true };
    const actor = createActor(hitlMachine, { input: reviewCtx });
    actor.start();
    actor.send({ type: "START" });
    actor.send({ type: "RESULT_READY", requiresReview: true });
    actor.send({ type: "TIMEOUT" });
    expect(actor.getSnapshot().value).toBe("ESCALATED");
    actor.stop();
  });
});
