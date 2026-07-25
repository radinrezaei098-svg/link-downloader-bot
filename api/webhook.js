import fs from 'fs';
import ffmpegPath from 'ffmpeg-static';
import ffmpeg from 'fluent-ffmpeg';

ffmpeg.setFfmpegPath(ffmpegPath);

const BOT_TOKEN = process.env.BOT_TOKEN;
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

const EXTENSION_MAP = {
  jpg: 'image', jpeg: 'image', png: 'image', gif: 'image', webp: 'image', bmp: 'image',
  mp4: 'video', mkv: 'video', avi: 'video', mov: 'video', webm: 'video', m4v: 'video',
  mp3: 'audio', wav: 'audio', ogg: 'audio', m4a: 'audio', flac: 'audio', aac: 'audio',
  pdf: 'document',
};

const INSTAGRAM_REGEX = /instagram\.com\/(reel|p|tv)\/([A-Za-z0-9_-]+)/i;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(200).json({ status: 'Link Downloader Bot is running ✅' });
    return;
  }

  try {
    const update = req.body;

    if (update.callback_query) {
      await handleCallback(update.callback_query);
      res.status(200).json({ ok: true });
      return;
    }

    const message = update?.message;
    if (!message || !message.text) {
      res.status(200).json({ ok: true });
      return;
    }

    const chatId = message.chat.id;
    const text = message.text.trim();

    if (text === '/start') {
      await sendMessage(
        chatId,
        'سلام! 👋\n\nبه بات *دانلودر لینک* خوش اومدی.\n\n📎 هر لینک مستقیم دانلود (عکس، ویدیو، موزیک، PDF) بفرستی، خودم می‌فرستمش.\n📸 لینک پست یا ریل اینستاگرام هم بفرستی، می‌تونی انتخاب کنی ویدیو کامل بخوای یا فقط صداش رو.'
      );
    } else if (text === '/help') {
      await sendMessage(
        chatId,
        'یه لینک بفرست:\n\n🔗 لینک مستقیم فایل → خودکار می‌فرستمش\n📸 لینک اینستاگرام (post/reel) → ازت می‌پرسم ویدیو می‌خوای یا فقط صدا'
      );
    } else if (INSTAGRAM_REGEX.test(text)) {
      await handleInstagramLink(chatId, text);
    } else if (isValidUrl(text)) {
      await handleGenericLink(chatId, text);
    } else {
      await sendMessage(chatId, 'این یه لینک معتبر نیست 🤔 لطفاً یه لینک مستقیم فایل یا لینک اینستاگرام بفرست.');
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(200).json({ ok: true });
  }
}

// ---------- اینستاگرام ----------

async function handleInstagramLink(chatId, url) {
  const match = url.match(INSTAGRAM_REGEX);
  const type = match[1]; // reel, p, tv
  const shortcode = match[2];

  await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: 'چی می‌خوای دریافت کنی؟',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🎬 ویدیو کامل', callback_data: `ig|video|${type}|${shortcode}` },
            { text: '🎵 فقط صدا (mp3)', callback_data: `ig|audio|${type}|${shortcode}` },
          ],
        ],
      },
    }),
  });
}

async function handleCallback(callback) {
  const chatId = callback.message.chat.id;
  const data = callback.data;

  if (!data.startsWith('ig|')) {
    await answerCallback(callback.id);
    return;
  }

  const [, mode, type, shortcode] = data.split('|');
  const igUrl = `https://www.instagram.com/${type}/${shortcode}/`;

  await answerCallback(callback.id, mode === 'video' ? '⏳ در حال دریافت ویدیو...' : '⏳ در حال استخراج صدا...');

  try {
    const media = await extractInstagramMedia(igUrl);

    if (!media || media.type !== 'video') {
      await sendMessage(chatId, '❌ نتونستم ویدیوی این پست رو پیدا کنم. ممکنه پست خصوصی باشه یا اینستاگرام دسترسی رو مسدود کرده باشه.');
      return;
    }

    if (mode === 'video') {
      await sendChatAction(chatId, 'upload_video');
      const ok = await trySend(chatId, media.url, 'video');
      if (!ok) await sendMessage(chatId, '❌ ارسال ویدیو ناموفق بود. لینک ممکنه منقضی شده باشه.');
    } else {
      await sendChatAction(chatId, 'upload_voice');
      await sendExtractedAudio(chatId, media.url);
    }
  } catch (err) {
    console.error('Instagram error:', err);
    await sendMessage(chatId, '❌ مشکلی توی دریافت از اینستاگرام پیش اومد. لطفاً دوباره امتحان کن.');
  }
}

async function extractInstagramMedia(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    },
    signal: AbortSignal.timeout(10000),
  });
  const html = await res.text();

  const videoMatch = html.match(/<meta property="og:video" content="([^"]+)"/);
  if (videoMatch) return { type: 'video', url: decodeEntities(videoMatch[1]) };

  const imageMatch = html.match(/<meta property="og:image" content="([^"]+)"/);
  if (imageMatch) return { type: 'image', url: decodeEntities(imageMatch[1]) };

  return null;
}

function decodeEntities(str) {
  return str.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#039;/g, "'");
}

async function sendExtractedAudio(chatId, videoUrl) {
  const stamp = Date.now();
  const tmpVideo = `/tmp/in_${stamp}.mp4`;
  const tmpAudio = `/tmp/out_${stamp}.mp3`;

  try {
    const videoRes = await fetch(videoUrl, { signal: AbortSignal.timeout(30000) });
    const videoBuffer = Buffer.from(await videoRes.arrayBuffer());
    fs.writeFileSync(tmpVideo, videoBuffer);

    await new Promise((resolve, reject) => {
      ffmpeg(tmpVideo)
        .noVideo()
        .audioCodec('libmp3lame')
        .audioBitrate('128k')
        .save(tmpAudio)
        .on('end', resolve)
        .on('error', reject);
    });

    const audioBuffer = fs.readFileSync(tmpAudio);

    const formData = new FormData();
    formData.append('chat_id', chatId);
    formData.append('audio', new Blob([audioBuffer], { type: 'audio/mpeg' }), 'audio.mp3');

    await fetch(`${TELEGRAM_API}/sendAudio`, { method: 'POST', body: formData });
  } finally {
    if (fs.existsSync(tmpVideo)) fs.unlinkSync(tmpVideo);
    if (fs.existsSync(tmpAudio)) fs.unlinkSync(tmpAudio);
  }
}

// ---------- لینک‌های عمومی (غیر اینستاگرام) ----------

function isValidUrl(text) {
  try {
    const url = new URL(text);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

async function handleGenericLink(chatId, url) {
  await sendChatAction(chatId, 'upload_document');

  const category = await detectCategory(url);
  const sent = await trySend(chatId, url, category);

  if (!sent) {
    const fallbackSent = await trySend(chatId, url, 'document');
    if (!fallbackSent) {
      await sendMessage(
        chatId,
        '❌ نتونستم این فایل رو دریافت کنم.\n\nممکنه دلیلش این‌ها باشه:\n• لینک مستقیم به فایل نیست\n• حجم فایل بیشتر از حد مجاز تلگرامه\n• سایت مبدأ اجازه دسترسی نمی‌ده'
      );
    }
  }
}

async function detectCategory(url) {
  const cleanPath = url.split('?')[0].split('#')[0];
  const ext = cleanPath.split('.').pop()?.toLowerCase();
  if (ext && EXTENSION_MAP[ext]) return EXTENSION_MAP[ext];

  try {
    const headRes = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(8000) });
    const contentType = headRes.headers.get('content-type') || '';
    if (contentType.startsWith('image/')) return 'image';
    if (contentType.startsWith('video/')) return 'video';
    if (contentType.startsWith('audio/')) return 'audio';
    if (contentType === 'application/pdf') return 'document';
  } catch {
    // پشتیبانی نشد، fallback به document
  }

  return 'document';
}

async function trySend(chatId, url, category) {
  const methodMap = { image: 'sendPhoto', video: 'sendVideo', audio: 'sendAudio', document: 'sendDocument' };
  const fieldMap = { image: 'photo', video: 'video', audio: 'audio', document: 'document' };

  const method = methodMap[category];
  const field = fieldMap[category];

  try {
    const res = await fetch(`${TELEGRAM_API}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, [field]: url }),
    });
    const data = await res.json();
    return data.ok === true;
  } catch {
    return false;
  }
}

// ---------- Telegram API helpers ----------

async function sendMessage(chatId, text) {
  await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
  });
}

async function sendChatAction(chatId, action) {
  await fetch(`${TELEGRAM_API}/sendChatAction`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, action }),
  });
}

async function answerCallback(callbackId, text) {
  await fetch(`${TELEGRAM_API}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackId, text }),
  });
}
