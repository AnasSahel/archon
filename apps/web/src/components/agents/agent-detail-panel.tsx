"use client";

import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "@/lib/api";
import type { AgentNode } from "./org-chart.js";

interface ApiKey {
  id: string;
  keyPrefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

interface AgentDetailPanelProps {
  agent: AgentNode & {
    llmConfig: { provider: string; model: string } | null;
    monthlyBudgetUsd: string | null;
    workspacePath: string | null;
    heartbeatCron: string | null;
  };
  companyId: string;
  userRole: string;
  onClose: () => void;
  onAgentUpdated: () => void;
}

export function AgentDetailPanel({
  agent,
  companyId,
  userRole,
  onClose,
  onAgentUpdated,
}: AgentDetailPanelProps) {
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [keysLoading, setKeysLoading] = useState(true);
  const [generatingKey, setGeneratingKey] = useState(false);
  const [newKeyRaw, setNewKeyRaw] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isBoard = userRole === "board";

  const loadKeys = useCallback(() => {
    setKeysLoading(true);
    apiFetch<ApiKey[]>(`/api/companies/${companyId}/agents/${agent.id}/api-keys`)
      .then(setApiKeys)
      .catch((err) => setError(err.message))
      .finally(() => setKeysLoading(false));
  }, [companyId, agent.id]);

  useEffect(() => {
    loadKeys();
  }, [loadKeys]);

  async function handleGenerateKey() {
    setGeneratingKey(true);
    setError(null);
    try {
      const result = await apiFetch<{ key: string; prefix: string; id: string }>(
        `/api/companies/${companyId}/agents/${agent.id}/api-keys`,
        { method: "POST" }
      );
      setNewKeyRaw(result.key);
      loadKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate key");
    } finally {
      setGeneratingKey(false);
    }
  }

  async function handleRevokeKey(keyId: string) {
    setRevoking(keyId);
    setError(null);
    try {
      await apiFetch(`/api/companies/${companyId}/api-keys/${keyId}`, { method: "DELETE" });
      loadKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to revoke key");
    } finally {
      setRevoking(null);
    }
  }

  function handleCopy() {
    if (newKeyRaw) {
      navigator.clipboard.writeText(newKeyRaw).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    }
  }

  const activeKeys = apiKeys.filter((k) => !k.revokedAt);
  const revokedKeys = apiKeys.filter((k) => k.revokedAt);

  return (
    <div className="fixed inset-y-0 right-0 w-96 bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-700 shadow-xl flex flex-col z-40">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
        <h2 className="text-base font-semibold text-gray-900 dark:text-white truncate">
          {agent.name}
        </h2>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 ml-2 shrink-0"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Agent Info */}
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">
            Agent Details
          </h3>
          <dl className="space-y-2">
            <div>
              <dt className="text-xs text-gray-400 dark:text-gray-500">Role</dt>
              <dd className="text-sm text-gray-900 dark:text-white">{agent.role}</dd>
            </div>
            <div>
              <dt className="text-xs text-gray-400 dark:text-gray-500">Status</dt>
              <dd className="text-sm">
                <span
                  className={`px-2 py-0.5 rounded text-xs font-medium ${
                    agent.status === "active"
                      ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                      : agent.status === "paused"
                      ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
                      : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                  }`}
                >
                  {agent.status}
                </span>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-gray-400 dark:text-gray-500">Adapter</dt>
              <dd className="text-sm text-gray-900 dark:text-white">{agent.adapterType}</dd>
            </div>
            {agent.llmConfig && (
              <div>
                <dt className="text-xs text-gray-400 dark:text-gray-500">LLM</dt>
                <dd className="text-sm text-gray-900 dark:text-white">
                  {agent.llmConfig.provider} / {agent.llmConfig.model}
                </dd>
              </div>
            )}
            {agent.monthlyBudgetUsd && (
              <div>
                <dt className="text-xs text-gray-400 dark:text-gray-500">Monthly Budget</dt>
                <dd className="text-sm text-gray-900 dark:text-white">${agent.monthlyBudgetUsd}</dd>
              </div>
            )}
            {agent.workspacePath && (
              <div>
                <dt className="text-xs text-gray-400 dark:text-gray-500">Workspace</dt>
                <dd className="text-sm text-gray-900 dark:text-white font-mono truncate">
                  {agent.workspacePath}
                </dd>
              </div>
            )}
            {agent.heartbeatCron && (
              <div>
                <dt className="text-xs text-gray-400 dark:text-gray-500">Heartbeat Cron</dt>
                <dd className="text-sm text-gray-900 dark:text-white font-mono">
                  {agent.heartbeatCron}
                </dd>
              </div>
            )}
          </dl>
        </div>

        {/* API Keys Section */}
        <div className="px-6 py-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
              API Keys
            </h3>
            {isBoard && (
              <button
                onClick={handleGenerateKey}
                disabled={generatingKey}
                className="text-xs px-2 py-1 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded transition-colors"
              >
                {generatingKey ? "Generating…" : "Generate key"}
              </button>
            )}
          </div>

          {error && (
            <div className="mb-3 p-2 bg-red-50 dark:bg-red-900/20 rounded text-xs text-red-700 dark:text-red-400">
              {error}
            </div>
          )}

          {/* Newly generated key — shown once */}
          {newKeyRaw && (
            <div className="mb-4 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg">
              <p className="text-xs font-medium text-amber-800 dark:text-amber-400 mb-2">
                Copy this key now — it will not be shown again.
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs font-mono bg-amber-100 dark:bg-amber-900/30 px-2 py-1 rounded text-amber-900 dark:text-amber-300 break-all">
                  {newKeyRaw}
                </code>
                <button
                  onClick={handleCopy}
                  className="shrink-0 text-xs px-2 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded transition-colors"
                >
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>
              <button
                onClick={() => setNewKeyRaw(null)}
                className="mt-2 text-xs text-amber-600 dark:text-amber-400 hover:underline"
              >
                Dismiss
              </button>
            </div>
          )}

          {keysLoading ? (
            <p className="text-xs text-gray-400 dark:text-gray-500">Loading keys…</p>
          ) : activeKeys.length === 0 && revokedKeys.length === 0 ? (
            <p className="text-xs text-gray-400 dark:text-gray-500">No API keys yet.</p>
          ) : (
            <div className="space-y-2">
              {activeKeys.map((key) => (
                <div
                  key={key.id}
                  className="flex items-center justify-between p-2 bg-gray-50 dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700"
                >
                  <div className="min-w-0">
                    <code className="text-xs font-mono text-gray-900 dark:text-white">
                      {key.keyPrefix}…
                    </code>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                      Created {new Date(key.createdAt).toLocaleDateString()}
                      {key.lastUsedAt && ` · Last used ${new Date(key.lastUsedAt).toLocaleDateString()}`}
                    </p>
                  </div>
                  {isBoard && (
                    <button
                      onClick={() => handleRevokeKey(key.id)}
                      disabled={revoking === key.id}
                      className="shrink-0 ml-2 text-xs text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 disabled:opacity-50 transition-colors"
                    >
                      {revoking === key.id ? "Revoking…" : "Revoke"}
                    </button>
                  )}
                </div>
              ))}

              {revokedKeys.length > 0 && (
                <details className="mt-2">
                  <summary className="text-xs text-gray-400 dark:text-gray-500 cursor-pointer hover:text-gray-600 dark:hover:text-gray-300">
                    {revokedKeys.length} revoked key{revokedKeys.length > 1 ? "s" : ""}
                  </summary>
                  <div className="mt-2 space-y-1">
                    {revokedKeys.map((key) => (
                      <div
                        key={key.id}
                        className="p-2 bg-gray-50 dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 opacity-50"
                      >
                        <code className="text-xs font-mono text-gray-500 dark:text-gray-400">
                          {key.keyPrefix}…
                        </code>
                        <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                          Revoked {key.revokedAt ? new Date(key.revokedAt).toLocaleDateString() : ""}
                        </p>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
