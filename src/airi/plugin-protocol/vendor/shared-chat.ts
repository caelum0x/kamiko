/** Minimal, vendored chat message types from @xsai/shared-chat — used type-only by the protocol. */
export type CommonContentPart = { type: string;[k: string]: unknown };
export interface UserMessage { role: 'user'; content: string | CommonContentPart[]; name?: string }
export interface AssistantMessage { role: 'assistant'; content?: string | CommonContentPart[]; name?: string; tool_calls?: unknown[] }
export interface ToolMessage { role: 'tool'; content: string; tool_call_id?: string }
export interface SystemMessage { role: 'system'; content: string; name?: string }
export type Message = UserMessage | AssistantMessage | ToolMessage | SystemMessage;
