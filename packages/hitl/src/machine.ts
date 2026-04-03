import { createMachine, assign } from "xstate";
import type { HitlContext, HitlEvent } from "./types.js";

export const hitlMachine = createMachine(
  {
    id: "hitl",
    initial: "IDLE",
    types: {} as {
      context: HitlContext;
      events: HitlEvent;
    },
    context: ({ input }: { input: HitlContext }) => input,
    states: {
      IDLE: {
        on: { START: "RUNNING" },
      },
      RUNNING: {
        on: {
          RESULT_READY: [
            {
              guard: "requiresReview",
              target: "AWAITING_HUMAN",
            },
            { target: "DONE" },
          ],
        },
      },
      AWAITING_HUMAN: {
        on: {
          APPROVE: "RUNNING",
          REJECT: {
            target: "RUNNING",
            actions: assign({
              humanFeedback: ({ event }) => (event as { type: "REJECT"; feedback?: string }).feedback,
            }),
          },
          COMMENT: {
            target: "RUNNING",
            actions: assign({
              humanFeedback: ({ event }) => (event as { type: "COMMENT"; content: string }).content,
            }),
          },
          TIMEOUT: "ESCALATED",
        },
      },
      ESCALATED: {
        on: {
          APPROVE: "RUNNING",
          REJECT: "RUNNING",
        },
      },
      DONE: { type: "final" },
    },
  },
  {
    guards: {
      requiresReview: ({ context }) => context.reviewRequired,
    },
  }
);
