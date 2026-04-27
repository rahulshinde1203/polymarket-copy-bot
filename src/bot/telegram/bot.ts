import TelegramBot from 'node-telegram-bot-api';
import { env } from '../../config/env';
import logger from '../../config/logger';
import { registerCommands } from './commands';

let bot: TelegramBot | null = null;

export function initBot(): void {
  bot = new TelegramBot(env.TELEGRAM_BOT_TOKEN, { polling: true });

  bot.on('polling_error', (err: Error) => {
    logger.error('Telegram polling error', err);
  });

  bot.on('error', (err: Error) => {
    logger.error('Telegram bot error', err);
  });

  registerCommands(bot);
  logger.info('Telegram bot started (polling)');
}

export async function stopBot(): Promise<void> {
  if (bot) {
    await bot.stopPolling();
    bot = null;
    logger.info('Telegram bot stopped');
  }
}
