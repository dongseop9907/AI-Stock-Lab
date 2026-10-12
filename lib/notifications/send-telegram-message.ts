interface TelegramSendMessageResponse {
  ok: boolean;

  description?: string;

  result?: {
    message_id: number;
    date: number;

    chat: {
      id: number;
      type: string;
    };

    text?: string;
  };
}

export interface TelegramMessageResult {
  messageId: number;
  chatId: string;
}

export async function sendTelegramMessage(
  text: string,
): Promise<TelegramMessageResult> {
  const token =
    process.env.TELEGRAM_BOT_TOKEN?.trim();

  const chatId =
    process.env.TELEGRAM_CHAT_ID?.trim();

  if (!token) {
    throw new Error(
      "TELEGRAM_BOT_TOKEN_NOT_CONFIGURED",
    );
  }

  if (!chatId) {
    throw new Error(
      "TELEGRAM_CHAT_ID_NOT_CONFIGURED",
    );
  }

  const normalizedText =
    text.trim();

  if (!normalizedText) {
    throw new Error(
      "TELEGRAM_MESSAGE_EMPTY",
    );
  }

  /*
   * Telegram sendMessage의 최대 길이를
   * 넘지 않도록 여유 있게 제한한다.
   */
  const safeText =
    normalizedText.slice(0, 4000);

  const response = await fetch(
    `https://api.telegram.org/bot${token}/sendMessage`,
    {
      method: "POST",

      headers: {
        "Content-Type":
          "application/json; charset=utf-8",
      },

      body: JSON.stringify({
        chat_id: chatId,
        text: safeText,
        disable_web_page_preview: true,
      }),

      cache: "no-store",
    },
  );

  const payload =
    (await response
      .json()
      .catch(() => ({
        ok: false,
        description:
          "텔레그램 응답을 해석하지 못했습니다.",
      }))) as TelegramSendMessageResponse;

  if (
    !response.ok ||
    !payload.ok ||
    !payload.result
  ) {
    throw new Error(
      payload.description ??
        `TELEGRAM_HTTP_${response.status}`,
    );
  }

  return {
    messageId:
      payload.result.message_id,

    chatId,
  };
}