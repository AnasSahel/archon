"use client";

export interface AgentNode {
  id: string;
  name: string;
  role: string;
  adapterType: string;
  status: string;
  parentAgentId: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  paused: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
  terminated: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
};

const ADAPTER_LABELS: Record<string, string> = {
  claude_code: "Claude Code",
  codex: "Codex",
  opencode: "OpenCode",
  http: "HTTP",
};

interface OrgChartNodeProps {
  agent: AgentNode;
  childAgents: AgentNode[];
  allAgents: AgentNode[];
  onSelect: (id: string) => void;
  selectedId: string | null;
}

function OrgChartNode({ agent, childAgents, allAgents, onSelect, selectedId }: OrgChartNodeProps) {
  const isSelected = agent.id === selectedId;
  const statusColor = STATUS_COLORS[agent.status] ?? "bg-gray-100 text-gray-700";

  return (
    <div className="flex flex-col gap-2">
      <button
        onClick={() => onSelect(agent.id)}
        className={`
          text-left w-64 p-4 rounded-lg border-2 transition-all
          ${isSelected
            ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20 dark:border-indigo-400"
            : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-indigo-300 dark:hover:border-indigo-600"
          }
        `}
      >
        <div className="flex items-start justify-between gap-2 mb-1">
          <span className="font-medium text-sm text-gray-900 dark:text-white truncate">
            {agent.name}
          </span>
          <span className={`shrink-0 px-1.5 py-0.5 rounded text-xs font-medium ${statusColor}`}>
            {agent.status}
          </span>
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{agent.role}</p>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
          {ADAPTER_LABELS[agent.adapterType] ?? agent.adapterType}
        </p>
      </button>

      {childAgents.length > 0 && (
        <div className="ml-8 pl-4 border-l-2 border-gray-200 dark:border-gray-700 flex flex-col gap-3">
          {childAgents.map((child) => (
            <OrgChartNode
              key={child.id}
              agent={child}
              childAgents={allAgents.filter((a) => a.parentAgentId === child.id)}
              allAgents={allAgents}
              onSelect={onSelect}
              selectedId={selectedId}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface OrgChartProps {
  agents: AgentNode[];
  onSelect: (id: string) => void;
  selectedId: string | null;
}

export function OrgChart({ agents, onSelect, selectedId }: OrgChartProps) {
  const roots = agents.filter((a) => !a.parentAgentId);

  if (agents.length === 0) {
    return (
      <div className="py-12 text-center text-gray-500 dark:text-gray-400 text-sm">
        No agents yet. Add your first agent to get started.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {roots.map((root) => (
        <OrgChartNode
          key={root.id}
          agent={root}
          childAgents={agents.filter((a) => a.parentAgentId === root.id)}
          allAgents={agents}
          onSelect={onSelect}
          selectedId={selectedId}
        />
      ))}
    </div>
  );
}
