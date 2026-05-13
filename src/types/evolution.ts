export type EvolutionConfig = {
  configured: boolean;
  base_url: string;
  has_api_key: boolean;
  active: boolean;
  last_test_at: string | null;
  last_test_status: "ok" | "invalid_key" | "unreachable" | "unknown" | null;
  last_test_detail: string | null;
};

export type WhatsAppInstanceStatus =
  | "pending"
  | "qr_pending"
  | "connected"
  | "disconnected"
  | "error";

export type WhatsAppInstance = {
  id: string;
  instance_name: string;
  display_name: string | null;
  phone_number: string | null;
  status: WhatsAppInstanceStatus;
  qr_code_b64: string | null;
  receives_marcos_chat: boolean;
  last_seen: string | null;
  created_at: string;
};
