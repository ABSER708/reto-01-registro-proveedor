import "dotenv/config";
import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { OpenAIAdapter } from "./llm/openai.js";
import type { ChatMessage, ToolCall } from "./llm/adapter.js";
import { getTool, toolSchemas, type ToolName } from "./tools/proveedor.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = express(); app.use(express.json({ limit: "1mb" })); app.use(express.static(path.join(root, "web")));
const sessions = new Map<string, { messages: ChatMessage[]; lastNeedsConfirmation: boolean; pendingCase?: string }>();
const provider = process.env.OPENAI_API_KEY ? new OpenAIAdapter(process.env.OPENAI_API_KEY, process.env.OPENAI_MODEL || "gpt-4o-mini") : null;
const maxIterations = Math.max(1, Number(process.env.MAX_TOOL_ITERATIONS || 12));
const prompt = await fs.readFile(path.join(root, "agent", "prompt.md"), "utf8");
const toolDefs = toolSchemas();
const humanize = (name: string) => name.replace(/^proveedor_/, "").replaceAll("_", " ");
function parseJson(content: string): unknown { try { return JSON.parse(content); } catch { return { raw: content }; } }

app.get("/api/health", (_req, res) => res.json({ ok: true, provider: provider ? "openai" : "demo-sin-modelo", model: provider?.model ?? null }));
app.get("/api/cases", async (_req, res) => {
  try { const base = path.join(root, "fixtures", "reto-01", "casos"); const names = await fs.readdir(base, { withFileTypes: true });
    const cases = await Promise.all(names.filter(x => x.isDirectory()).map(async x => { const data = JSON.parse(await fs.readFile(path.join(base, x.name, "solicitud.json"), "utf8")) as { id: string; cliente: string; pais: string; formato: string }; return { id: data.id, cliente: data.cliente, pais: data.pais, formato: data.formato }; }));
    res.json({ cases });
  } catch { res.status(500).json({ error: "No fue posible cargar los casos." }); }
});
app.get("/api/sessions/:id", (req, res) => { const session = sessions.get(req.params.id); if (!session) return res.status(404).json({ error: "Sesión no encontrada." }); res.json({ messages: session.messages, needsConfirmation: session.lastNeedsConfirmation }); });
app.post("/api/chat", async (req, res) => {
  const body = req.body as { sessionId?: string; message?: string };
  const sessionId = String(body.sessionId || crypto.randomUUID()); const message = String(body.message || "").trim();
  if (!message) return res.status(400).json({ error: "Escribe un mensaje para continuar." });
  let session = sessions.get(sessionId); if (!session) { session = { messages: [{ role: "system", content: prompt }], lastNeedsConfirmation: false }; sessions.set(sessionId, session); }
  const priorTurnNeedsConfirmation = session.lastNeedsConfirmation;
  session.messages.push({ role: "user", content: message });
  const callsForUi: Array<{ name: string; arguments: unknown; result: unknown; ok: boolean }> = [];
  const confirmationIntent = /^(si|sí|confirmo|confirmar|sí,? confirma|autorizo)(\b|\s|,)/i.test(message);
  let reply = ""; let needsConfirmation = false;
  if (!provider) {
    reply = "El backend está en modo sin modelo porque OPENAI_API_KEY no está configurada. Puedes ejecutar `bun run demo` para verificar las herramientas; para conversar con el agente configura la clave en el backend.";
  } else {
    try {
      let iteration = 0;
      while (iteration < maxIterations) {
        iteration++;
        const response = await provider.enviar(session.messages, toolDefs);
        session.messages.push(response.message);
        if (!response.toolCalls.length) { reply = response.message.content || "No recibí texto de respuesta del modelo."; break; }
        for (const call of response.toolCalls as ToolCall[]) {
          const toolName = call.function.name; const shortName = toolName.replace(/^proveedor_/, "") as ToolName; const tool = getTool(shortName);
          let args: unknown; try { args = JSON.parse(call.function.arguments); } catch { args = {}; }
          let raw: string;
          if (!tool) raw = JSON.stringify({ ok: false, error: "Herramienta no disponible." });
          else if (shortName === "simular_envio" && !(priorTurnNeedsConfirmation && confirmationIntent)) raw = JSON.stringify({ ok: false, error: "requiere confirmación explícita en el turno inmediatamente anterior" });
          else {
            const parsed = (await import("./tools/proveedor.js")).toolRegistry[shortName].args;
            const validation = (await import("zod")).z.object(parsed).safeParse(args);
            if (!validation.success) raw = JSON.stringify({ ok: false, error: `Argumentos inválidos: ${validation.error.issues.map(x => x.message).join("; ")}` });
            else {
              const toolCtx = { directory: root, sessionId };
              raw = await (tool as unknown as { execute: (a: never, c: typeof toolCtx) => Promise<string> }).execute(validation.data as never, toolCtx);
            }
          }
          const parsedResult = parseJson(raw); const ok = Boolean((parsedResult as { ok?: boolean }).ok);
          callsForUi.push({ name: toolName, arguments: args, result: parsedResult, ok });
          session.messages.push({ role: "tool", tool_call_id: call.id, name: toolName, content: raw });
        }
      }
      if (!reply) reply = `Llegué al límite de ${maxIterations} iteraciones. Revisa las llamadas registradas y dime cómo deseas continuar.`;
      needsConfirmation = /confirmaci[oó]n|¿.*(confirm|env[ií]o|enviar)|deseas.*(simulad|env[ií])/i.test(reply) && !confirmationIntent;
      if (confirmationIntent && callsForUi.some(c => c.name === "proveedor_simular_envio" && c.ok)) needsConfirmation = false;
    } catch (error) { reply = error instanceof Error ? error.message : "Ocurrió un error al procesar la solicitud."; }
  }
  session.lastNeedsConfirmation = needsConfirmation;
  const entry = { ts: new Date().toISOString(), herramienta: "chat_turno", ok: true, resumen: `session=${sessionId}; tools=${callsForUi.length}` };
  await fs.mkdir(path.join(root, "out", "logs"), { recursive: true }); await fs.appendFile(path.join(root, "out", "logs", `${sessionId}.jsonl`), `${JSON.stringify(entry)}\n`).catch(() => undefined);
  res.json({ sessionId, reply, toolCalls: callsForUi, needsConfirmation, history: session.messages.filter(m => m.role !== "system") });
});
const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`Reto 01 disponible en http://localhost:${port}`));
