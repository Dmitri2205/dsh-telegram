import { IncomingMessage, ServerResponse } from "node:http";
export interface TelegramMessage {
    message_id: number;
    chat: {
        id: number;
        type: string;
        title?: string;
        username?: string;
    };
    from?: {
        id: number;
        is_bot?: boolean;
        first_name?: string;
        username?: string;
    };
    date: number;
    text?: string;
    caption?: string;
    photo?: Array<{
        file_id: string;
        file_unique_id: string;
        width: number;
        height: number;
    }>;
    document?: {
        file_id: string;
        file_unique_id: string;
        file_name?: string;
        mime_type?: string;
    };
    audio?: object;
    video?: object;
    sticker?: object;
    voice?: object;
    contact?: object;
    location?: {
        latitude: number;
        longitude: number;
    };
    entities?: Array<{
        type: string;
        offset: number;
        length: number;
    }>;
}
export interface TelegramCallbackQuery {
    id: string;
    message?: {
        message_id: number;
        chat: {
            id: number;
        };
    };
    data: string;
    from?: {
        id: number;
        username?: string;
    };
}
export interface TelegramUpdate {
    update_id: number;
    message?: TelegramMessage;
    edited_message?: TelegramMessage;
    channel_post?: TelegramMessage;
    callback_query?: TelegramCallbackQuery;
}
export interface WebhookConfig {
    webhookSecret: string;
    allowedChatIds?: number[];
}
/**
 * Create a webhook handler for Telegram updates.
 * Validates the secret token, parses the update, and dispatches to the router.
 */
export declare function createWebhookHandler(config: WebhookConfig, router: {
    routeMessage(chatId: number, message: {
        text?: string;
        photo?: string[];
        document?: string;
    }): Promise<void>;
}): (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
//# sourceMappingURL=webhook.d.ts.map