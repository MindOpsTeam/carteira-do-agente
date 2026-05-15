export type TelegramBotTestStatus = 'ok' | 'invalid_token' | 'unreachable' | 'unknown' | null;

export type TelegramBot = {
  id: string;
  bot_name: string;
  bot_username: string;
  active: boolean;
  receives_marcos_chat: boolean;
  last_test_at: string | null;
  last_test_status: TelegramBotTestStatus;
  last_test_detail?: string | null;
  created_at: string;
};
