import { getDocker } from "./docker-manager.js";

const ARCHON_NETWORK_NAME = "archon-agents";

/**
 * Ensures the dedicated archon-agents bridge network exists.
 * This network is used for all agent containers to isolate them from the default bridge.
 *
 * Note: For production outbound filtering (api.anthropic.com, api.openai.com only),
 * apply host-level iptables rules targeting the archon-agents subnet.
 */
export async function ensureAgentNetwork(): Promise<string> {
  const docker = getDocker();
  const networks = await docker.listNetworks({
    filters: JSON.stringify({ name: [ARCHON_NETWORK_NAME] }),
  });

  if (networks.length > 0 && networks[0]?.Id) {
    return ARCHON_NETWORK_NAME;
  }

  await docker.createNetwork({
    Name: ARCHON_NETWORK_NAME,
    Driver: "bridge",
    CheckDuplicate: true,
    Labels: { "archon.managed": "true" },
  });

  return ARCHON_NETWORK_NAME;
}
