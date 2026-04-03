"use client";

import { useEffect, useState } from "react";

interface StreamEvent {
  type: string;
  agentId?: string;
  taskId?: string;
  message?: string;
}

export function SSEIndicator({ companyId }: { companyId: string }) {
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const SERVER_URL =
    process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:3100";

  useEffect(() => {
    const es = new EventSource(
      `${SERVER_URL}/api/stream/companies/${companyId}`,
      { withCredentials: true }
    );

    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);

    const handleEvent = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data as string) as StreamEvent;
        setEvents((prev) => [data, ...prev].slice(0, 20));
      } catch {
        /* ignore parse errors */
      }
    };

    const eventTypes = [
      "heartbeat_started",
      "heartbeat_completed",
      "task_updated",
      "hitl_gate_triggered",
      "budget_alert",
      "agent_log",
    ];

    for (const type of eventTypes) {
      es.addEventListener(type, handleEvent);
    }

    return () => es.close();
  }, [companyId, SERVER_URL]);

  return (
    <div className="text-xs">
      <div className="flex items-center gap-1 mb-2">
        <div
          className={`h-2 w-2 rounded-full ${connected ? "bg-green-500" : "bg-gray-400"}`}
        />
        <span className="text-gray-500">
          {connected ? "Live" : "Disconnected"}
        </span>
      </div>
      {events.slice(0, 5).map((ev, i) => (
        <div key={i} className="text-gray-600 truncate">
          {ev.type}: {ev.agentId ?? ev.taskId ?? ""}
        </div>
      ))}
    </div>
  );
}
