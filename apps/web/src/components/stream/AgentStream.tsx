"use client";

import { useEffect, useRef, useState } from "react";

interface AgentStreamProps {
  companyId: string;
  /** If provided, only show events for this agent */
  agentId?: string;
  /** If provided, only show events for this task */
  taskId?: string;
  /** Called when a heartbeat completes so the parent can refresh data */
  onHeartbeatCompleted?: () => void;
}

interface StreamLine {
  id: number;
  kind: "token" | "status" | "error";
  text: string;
}

let lineCounter = 0;

export function AgentStream({
  companyId,
  agentId,
  taskId,
  onHeartbeatCompleted,
}: AgentStreamProps) {
  const [lines, setLines] = useState<StreamLine[]>([]);
  const [connected, setConnected] = useState(false);
  const [running, setRunning] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const pendingTokenRef = useRef<string>("");

  const SERVER_URL =
    process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:3010";

  useEffect(() => {
    const es = new EventSource(
      `${SERVER_URL}/api/stream/companies/${companyId}`,
      { withCredentials: true }
    );

    es.onopen = () => setConnected(true);
    es.onerror = () => {
      setConnected(false);
      setRunning(false);
    };

    function matchesFilter(data: Record<string, unknown>): boolean {
      if (agentId && data["agentId"] !== agentId) return false;
      if (taskId && data["taskId"] !== undefined && data["taskId"] !== taskId)
        return false;
      return true;
    }

    function addLine(kind: StreamLine["kind"], text: string) {
      setLines((prev) => {
        const next = [...prev, { id: lineCounter++, kind, text }];
        // Keep last 500 lines
        return next.length > 500 ? next.slice(next.length - 500) : next;
      });
    }

    function flushPendingToken() {
      const text = pendingTokenRef.current;
      if (text) {
        pendingTokenRef.current = "";
        addLine("token", text);
      }
    }

    es.addEventListener("heartbeat_started", (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data as string) as Record<string, unknown>;
        if (!matchesFilter(data)) return;
        flushPendingToken();
        setRunning(true);
        setLines([]);
        addLine("status", "▶ Agent running…");
      } catch {
        /* ignore */
      }
    });

    es.addEventListener("heartbeat_token", (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data as string) as Record<string, unknown>;
        if (!matchesFilter(data)) return;
        const chunk = typeof data["token"] === "string" ? data["token"] : "";
        pendingTokenRef.current += chunk;
        // Flush on newlines to avoid too many re-renders
        if (pendingTokenRef.current.includes("\n")) {
          const parts = pendingTokenRef.current.split("\n");
          pendingTokenRef.current = parts.pop() ?? "";
          for (const part of parts) {
            addLine("token", part);
          }
        }
      } catch {
        /* ignore */
      }
    });

    es.addEventListener("heartbeat_completed", (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data as string) as Record<string, unknown>;
        if (!matchesFilter(data)) return;
        flushPendingToken();
        setRunning(false);
        const cost =
          typeof data["costUsd"] === "number"
            ? ` · $${data["costUsd"].toFixed(6)}`
            : "";
        addLine("status", `✓ Completed${cost}`);
        onHeartbeatCompleted?.();
      } catch {
        /* ignore */
      }
    });

    es.addEventListener("agent_log", (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data as string) as Record<string, unknown>;
        if (!matchesFilter(data)) return;
        if (data["level"] === "error") {
          flushPendingToken();
          setRunning(false);
          addLine("error", `✗ ${String(data["message"] ?? "")}`);
        }
      } catch {
        /* ignore */
      }
    });

    return () => es.close();
  }, [companyId, agentId, taskId, SERVER_URL, onHeartbeatCompleted]);

  // Auto-scroll to bottom when new lines arrive
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines]);

  if (!connected && lines.length === 0) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-gray-400 dark:text-gray-500">
        <span className="h-1.5 w-1.5 rounded-full bg-gray-300 dark:bg-gray-600" />
        Connecting to live stream…
      </div>
    );
  }

  return (
    <div className="rounded-md border border-gray-200 dark:border-gray-700 overflow-hidden">
      {/* Header bar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-1.5">
          <span
            className={`h-1.5 w-1.5 rounded-full transition-colors ${
              connected
                ? running
                  ? "bg-green-500 animate-pulse"
                  : "bg-green-500"
                : "bg-gray-400"
            }`}
          />
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {running ? "Live" : connected ? "Idle" : "Disconnected"}
          </span>
        </div>
        {lines.length > 0 && (
          <button
            onClick={() => setLines([])}
            className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      {/* Terminal body */}
      <div className="bg-gray-950 text-green-400 font-mono text-xs px-3 py-2 h-36 overflow-y-auto">
        {lines.length === 0 ? (
          <span className="text-gray-600">Waiting for agent activity…</span>
        ) : (
          lines.map((line) => (
            <div
              key={line.id}
              className={
                line.kind === "status"
                  ? "text-gray-400"
                  : line.kind === "error"
                  ? "text-red-400"
                  : "text-green-400"
              }
            >
              {line.text || "\u00A0"}
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
