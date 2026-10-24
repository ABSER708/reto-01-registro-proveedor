import type { ChatMessage, LlmAdapter, LlmResponse, LlmTool } from "./adapter.js";

export class OpenAIAdapter implements LlmAdapter {
  readonly model: string;
  constructor(private readonly apiKey: string, model = "gpt-4o-mini") { this.model = model; }
  async enviar(mensajes: ChatMessage[], herramientas: LlmTool[]): Promise<LlmResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45_000);
    try {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST", signal: controller.signal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({ model: this.model, messages: mensajes, tools: herramientas, tool_choice: "auto", temperature: 0.1, max_tokens: 1200 })
      });
      if (!response.ok) throw new Error(`El proveedor de IA respondió con estado ${response.status}. Verifica la clave, el modelo y los límites de uso.`);
      const payload = await response.json() as { choices?: Array<{ message?: ChatMessage }> };
      const message = payload.choices?.[0]?.message;
      if (!message) throw new Error("El proveedor de IA devolvió una respuesta vacía.");
      return { message, toolCalls: message.tool_calls ?? [] };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw new Error("Tiempo de espera agotado al consultar el modelo.");
      throw error instanceof Error ? error : new Error("No fue posible consultar el modelo.");
    } finally { clearTimeout(timeout); }
  }
}
