import Docker from "dockerode";

let _docker: Docker | null = null;

export function getDocker(): Docker {
  if (!_docker) {
    const socketPath = process.env.DOCKER_SOCKET ?? "/var/run/docker.sock";
    _docker = new Docker({ socketPath });
  }
  return _docker;
}

export async function isDockerAvailable(): Promise<boolean> {
  try {
    await getDocker().ping();
    return true;
  } catch {
    return false;
  }
}
