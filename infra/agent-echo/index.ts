/**
 * Agent Echo Server — TRU-113 (Phase C2)
 * Minimal HTTP server that mimics an agent endpoint for local testing.
 *
 * POST /heartbeat
 *   body: { agentId: string, taskId?: string, context?: string }
 *   response: { result: string, usage: { input_tokens: number, output_tokens: number } }
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

const PORT = Number(process.env.ECHO_PORT ?? 3200);

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => { data += chunk; });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  if (req.method === "POST" && req.url === "/heartbeat") {
    try {
      const raw = await readBody(req);
      const body = JSON.parse(raw || "{}") as { agentId?: string; taskId?: string; context?: string };

      const context = body.context ?? "(no context)";
      const payload = {
        result: `Echo: ${context}`,
        usage: { input_tokens: 10, output_tokens: 50 },
      };

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(payload));
      console.log(`[echo] POST /heartbeat agentId=${body.agentId ?? "?"} taskId=${body.taskId ?? "?"}`);
    } catch (err) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Bad request" }));
    }
  } else {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  }
});

server.listen(PORT, () => {
  console.log(`[echo] Agent echo server listening on http://localhost:${PORT}`);
});
