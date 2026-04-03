// Guards are defined inline in machine.ts but exported here for testing
export const guards = {
  requiresReview: ({ context }: { context: { reviewRequired: boolean } }) =>
    context.reviewRequired,
};
