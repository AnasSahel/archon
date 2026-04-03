export { getDocker, isDockerAvailable } from "./docker-manager.js";
export { runAgentContainer, removeZombieContainers } from "./container-lifecycle.js";
export type { ContainerRunOptions } from "./container-lifecycle.js";
export { ensureAgentNetwork } from "./network.js";
