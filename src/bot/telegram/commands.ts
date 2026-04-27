import TelegramBot from 'node-telegram-bot-api';
import redis from '../../infra/cache/redis';
import {
  addTrader,
  removeTrader,
  listTraders,
  setActiveTrader,
  getActiveTrader,
  updateCopyPercentage,
} from '../../services/trader.service';
import logger from '../../config/logger';
import { env } from '../../config/env';

// ── Constants ─────────────────────────────────────────────────────────────────

const BOT_RUNNING_KEY = 'bot_running';

// ── Auth ──────────────────────────────────────────────────────────────────────

function isAuthorized(userId: number | undefined): boolean {
  if (userId === undefined) return false;
  return (env.ALLOWED_USER_IDS as readonly number[]).includes(userId);
}

// ── Error reply ───────────────────────────────────────────────────────────────

async function replyError(bot: TelegramBot, chatId: number, err: unknown): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  logger.error(`Command error: ${message}`, err instanceof Error ? err : undefined);
  try {
    await bot.sendMessage(chatId, `❌ ${message}`);
  } catch {
    // suppress secondary send failure
  }
}

// ── Arg parsing helpers ───────────────────────────────────────────────────────

function parseArgs(text: string, command: string): string[] {
  // Strip "/command" or "/command@botname" from the front, then split remaining
  const stripped = text.replace(new RegExp(`^\/${command}(?:@\\w+)?\\s*`, 'i'), '').trim();
  return stripped.length > 0 ? stripped.split(/\s+/) : [];
}

// ── Command registration ──────────────────────────────────────────────────────

export function registerCommands(bot: TelegramBot): void {

  // /start — mark bot as running
  bot.onText(/^\/start(?:@\w+)?$/i, async (msg) => {
    const { id: chatId } = msg.chat;
    const userId = msg.from?.id;
    logger.info(`/start from user ${userId}`);
    try {
      if (!isAuthorized(userId)) { await bot.sendMessage(chatId, '⛔ Unauthorized'); return; }
      await redis.set(BOT_RUNNING_KEY, 'true');
      await bot.sendMessage(chatId, '✅ Bot started');
    } catch (err) { await replyError(bot, chatId, err); }
  });

  // /stop — mark bot as stopped
  bot.onText(/^\/stop(?:@\w+)?$/i, async (msg) => {
    const { id: chatId } = msg.chat;
    const userId = msg.from?.id;
    logger.info(`/stop from user ${userId}`);
    try {
      if (!isAuthorized(userId)) { await bot.sendMessage(chatId, '⛔ Unauthorized'); return; }
      await redis.set(BOT_RUNNING_KEY, 'false');
      await bot.sendMessage(chatId, '🛑 Bot stopped');
    } catch (err) { await replyError(bot, chatId, err); }
  });

  // /status — show bot running state + active trader
  bot.onText(/^\/status(?:@\w+)?$/i, async (msg) => {
    const { id: chatId } = msg.chat;
    const userId = msg.from?.id;
    logger.info(`/status from user ${userId}`);
    try {
      if (!isAuthorized(userId)) { await bot.sendMessage(chatId, '⛔ Unauthorized'); return; }

      const [runningFlag, trader] = await Promise.all([
        redis.get(BOT_RUNNING_KEY),
        getActiveTrader(),
      ]);

      const stateLabel = runningFlag === 'true' ? 'Running ✅' : 'Stopped 🔴';
      const traderLabel = trader
        ? `\`${trader.address}\`${trader.tag ? ` (${trader.tag})` : ''}${trader.copy_percentage ? ` — ${trader.copy_percentage}%` : ''}`
        : 'None';

      const text = [
        '📊 *Bot Status*',
        '',
        `State: ${stateLabel}`,
        `Active trader: ${traderLabel}`,
      ].join('\n');

      await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    } catch (err) { await replyError(bot, chatId, err); }
  });

  // /list — show all registered traders
  bot.onText(/^\/list(?:@\w+)?$/i, async (msg) => {
    const { id: chatId } = msg.chat;
    const userId = msg.from?.id;
    logger.info(`/list from user ${userId}`);
    try {
      if (!isAuthorized(userId)) { await bot.sendMessage(chatId, '⛔ Unauthorized'); return; }

      const traders = await listTraders();

      if (traders.length === 0) {
        await bot.sendMessage(chatId, '📋 No traders registered yet.');
        return;
      }

      const lines = traders.map((t, i) => {
        const pct = t.copy_percentage != null ? `${t.copy_percentage}%` : '—';
        const tag = t.tag ? ` (${t.tag})` : '';
        return `${i + 1}. \`${t.address}\`${tag} — ${pct}`;
      });

      await bot.sendMessage(
        chatId,
        [`📋 *Traders (${traders.length}):*`, '', ...lines].join('\n'),
        { parse_mode: 'Markdown' },
      );
    } catch (err) { await replyError(bot, chatId, err); }
  });

  // /add <address> [tag] [pct]
  bot.onText(/^\/add(?:@\w+)?(?:\s|$)/i, async (msg) => {
    const { id: chatId } = msg.chat;
    const userId = msg.from?.id;
    logger.info(`/add from user ${userId}`);
    try {
      if (!isAuthorized(userId)) { await bot.sendMessage(chatId, '⛔ Unauthorized'); return; }

      const args = parseArgs(msg.text ?? '', 'add');
      const [address, tag, pctStr] = args;

      if (!address) {
        await bot.sendMessage(chatId, 'Usage: `/add <address> [tag] [pct]`', { parse_mode: 'Markdown' });
        return;
      }

      const pct = pctStr !== undefined ? parseFloat(pctStr) : undefined;
      if (pct !== undefined && isNaN(pct)) {
        await bot.sendMessage(chatId, '❌ Invalid percentage — must be a number (e.g. `80` or `75.5`)', { parse_mode: 'Markdown' });
        return;
      }

      const trader = await addTrader(address, tag || undefined, pct);
      await bot.sendMessage(
        chatId,
        `✅ Trader added: \`${trader.address}\`${trader.tag ? ` (${trader.tag})` : ''}`,
        { parse_mode: 'Markdown' },
      );
    } catch (err) { await replyError(bot, chatId, err); }
  });

  // /remove <address>
  bot.onText(/^\/remove(?:@\w+)?(?:\s|$)/i, async (msg) => {
    const { id: chatId } = msg.chat;
    const userId = msg.from?.id;
    logger.info(`/remove from user ${userId}`);
    try {
      if (!isAuthorized(userId)) { await bot.sendMessage(chatId, '⛔ Unauthorized'); return; }

      const args = parseArgs(msg.text ?? '', 'remove');
      const [address] = args;

      if (!address) {
        await bot.sendMessage(chatId, 'Usage: `/remove <address>`', { parse_mode: 'Markdown' });
        return;
      }

      await removeTrader(address);
      await bot.sendMessage(chatId, `✅ Trader removed: \`${address}\``, { parse_mode: 'Markdown' });
    } catch (err) { await replyError(bot, chatId, err); }
  });

  // /select <address>
  bot.onText(/^\/select(?:@\w+)?(?:\s|$)/i, async (msg) => {
    const { id: chatId } = msg.chat;
    const userId = msg.from?.id;
    logger.info(`/select from user ${userId}`);
    try {
      if (!isAuthorized(userId)) { await bot.sendMessage(chatId, '⛔ Unauthorized'); return; }

      const args = parseArgs(msg.text ?? '', 'select');
      const [address] = args;

      if (!address) {
        await bot.sendMessage(chatId, 'Usage: `/select <address>`', { parse_mode: 'Markdown' });
        return;
      }

      await setActiveTrader(address);
      await bot.sendMessage(
        chatId,
        `✅ Active trader set: \`${address}\``,
        { parse_mode: 'Markdown' },
      );
    } catch (err) { await replyError(bot, chatId, err); }
  });

  // /setpct <number> — update copy % for currently active trader
  bot.onText(/^\/setpct(?:@\w+)?(?:\s|$)/i, async (msg) => {
    const { id: chatId } = msg.chat;
    const userId = msg.from?.id;
    logger.info(`/setpct from user ${userId}`);
    try {
      if (!isAuthorized(userId)) { await bot.sendMessage(chatId, '⛔ Unauthorized'); return; }

      const args = parseArgs(msg.text ?? '', 'setpct');
      const [pctStr] = args;
      const pct = parseFloat(pctStr ?? '');

      if (!pctStr || isNaN(pct)) {
        await bot.sendMessage(chatId, 'Usage: `/setpct <0-100>`', { parse_mode: 'Markdown' });
        return;
      }

      const trader = await getActiveTrader();
      if (!trader) {
        await bot.sendMessage(chatId, '❌ No active trader. Use /select first.');
        return;
      }

      await updateCopyPercentage(trader.address, pct);
      await bot.sendMessage(
        chatId,
        `✅ Copy % updated: \`${trader.address}\` → ${pct}%`,
        { parse_mode: 'Markdown' },
      );
    } catch (err) { await replyError(bot, chatId, err); }
  });

  logger.info('Telegram commands registered');
}
