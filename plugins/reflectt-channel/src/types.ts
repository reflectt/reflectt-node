/**
 * Types for reflectt-node integration
 */

export type ReflecttConfig = {
  enabled?: boolean;
  url?: string;
};

export type ResolvedReflecttAccount = {
  accountId: string;
  enabled: boolean;
  config: ReflecttConfig;
  url: string;
};

export type ReflecttChatMessage = {
  id: string;
  from: string;
  channel: string;
  content: string;
  timestamp: number;
  mentions?: string[];
};

export type ReflecttEvent = {
  type: "chat_message" | "system" | "agent_status";
  data: ReflecttChatMessage | Record<string, unknown>;
};
