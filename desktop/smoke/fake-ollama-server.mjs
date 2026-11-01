import http from "node:http";

const port = Number(process.env.OVULE_FAKE_OLLAMA_PORT ?? "11435");
const collectBody = async (request) => {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 1024 * 1024) throw new Error("request too large");
  }
  return JSON.parse(body);
};
const writeChunk = (response, body, delta, finishReason = null) => {
  response.write(
    `data: ${JSON.stringify({
      id: "ollama-smoke",
      object: "chat.completion.chunk",
      created: 1,
      model: body.model ?? "smollm2:135m",
      choices: [{ index: 0, delta, finish_reason: finishReason }],
    })}\n\n`,
  );
};
const server = http.createServer((request, response) => {
  if (request.url === "/api/tags") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        models: [
          {
            name: "smollm2:135m",
            model: "smollm2:135m",
            size: 271_000_000,
            modified_at: new Date().toISOString(),
          },
        ],
      }),
    );
    return;
  }
  if (request.method === "POST" && request.url === "/v1/chat/completions") {
    void collectBody(request)
      .then(async (body) => {
        response.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
        });
        const computerTool = body.tools?.find(
          (tool) =>
            tool.function?.name === "ovule_computer_control" ||
            tool.function?.name?.startsWith("mcp_"),
        );
        const hasToolResult = body.messages?.some((message) => message.role === "tool");
        if (computerTool && !hasToolResult) {
          writeChunk(response, body, {
            tool_calls: [
              {
                index: 0,
                id: "call-crd-computer-use-ollama",
                type: "function",
                function: {
                  name: computerTool.function.name,
                  arguments: JSON.stringify({ action: "screenshot" }),
                },
              },
            ],
          });
          writeChunk(response, body, {}, "tool_calls");
        } else {
          for (const delta of ["OLLAMA_CDP_OK ", "CRD_COMPUTER_USE_CDP_OK"]) {
            writeChunk(response, body, { content: delta });
            // Cross the Host's 50 ms persistence debounce so the smoke test
            // verifies more than a single coalesced database write.
            await new Promise((resolve) => setTimeout(resolve, 75));
          }
          writeChunk(response, body, {}, "stop");
        }
        response.end("data: [DONE]\n\n");
      })
      .catch((error) => {
        response.writeHead(400, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: { message: String(error) } }));
      });
    return;
  }
  response.writeHead(404, { "content-type": "application/json" });
  response.end(JSON.stringify({ error: "not found" }));
});
server.listen(port, "127.0.0.1", () => process.stdout.write(`fake_ollama_ready=${port}\n`));
