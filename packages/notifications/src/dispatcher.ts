export type NotificationEvent =
  | { type: "heartbeat_started"; agentId: string; taskId?: string }
  | {
      type: "heartbeat_completed";
      agentId: string;
      status: string;
      costUsd: number;
    }
  | { type: "task_updated"; taskId: string; status: string; agentId?: string }
  | { type: "hitl_gate_triggered"; taskId: string; agentId: string }
  | {
      type: "budget_alert";
      agentId: string;
      percentUsed: number;
      status: string;
    }
  | { type: "agent_log"; agentId: string; level: string; message: string }
  | { type: "heartbeat_token"; agentId: string; taskId?: string; token: string };

type Subscriber = (event: NotificationEvent) => void;

const subscribers = new Set<Subscriber>();

export function subscribe(fn: Subscriber): () => void {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

export function dispatch(event: NotificationEvent): void {
  for (const fn of subscribers) {
    try {
      fn(event);
    } catch {
      /* ignore subscriber errors */
    }
  }
}
