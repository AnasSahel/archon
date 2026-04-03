#!/usr/bin/env bash
# Build Docker images for CLI agent containers
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DOCKERFILE_DIR="$REPO_ROOT/infra/docker/agents"

echo "Building agent Docker images..."

docker build -t archon-agent-claude:latest \
  -f "$DOCKERFILE_DIR/Dockerfile.claude" \
  "$DOCKERFILE_DIR"

docker build -t archon-agent-codex:latest \
  -f "$DOCKERFILE_DIR/Dockerfile.codex" \
  "$DOCKERFILE_DIR"

docker build -t archon-agent-opencode:latest \
  -f "$DOCKERFILE_DIR/Dockerfile.opencode" \
  "$DOCKERFILE_DIR"

echo "All agent images built successfully."
echo "  archon-agent-claude:latest"
echo "  archon-agent-codex:latest"
echo "  archon-agent-opencode:latest"
