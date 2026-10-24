export type ChatMessage = { role: "system" | "user" | "assistant" | "tool"; content: string; name?: string; tool_call_id?: string; tool_calls?: ToolCall[] };
export type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
export type LlmTool = { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } };
export type LlmResponse = { message: ChatMessage; toolCalls: ToolCall[] };
export interface LlmAdapter { enviar(mensajes: ChatMessage[], herramientas: LlmTool[]): Promise<LlmResponse>; readonly model: string; }
