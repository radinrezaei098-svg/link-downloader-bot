const BOT_TOKEN = process.env.BOT_TOKEN;
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

const EXTENSION_MAP = {
  // تصویر
  jpg: 'image', jpeg: 'image', png: 'image', gif: 'image', webp: 'image', bmp: 'image',
  // ویدیو
  mp4: 'video', mkv: 'video', avi: 'video', mov: 'video', webm: 'video', m4v: 'video',
  // صدا
  mp3: 'audio', wav: 'audio', ogg: 'audio', m4a: 'audio', flac: 'audio', aac: 'audio',
  // سند
  pdf: 'document',
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(200).json({ status: 'Link Downloader Bot is running ✅' });
    return;
  }

  try {
    const update = req.body;
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
        'سلام! 👋\n\nبه بات *دانلودر لینک* خوش اومدی.\n\nهر لینک مستقیم دانلود بفرستی (عکس، ویدیو، موزیک یا PDF)، خودم نوعش رو تشخیص می‌دم و برات می‌فرستم. فقط کافیه لینک رو بفرستی. 📎'
      );
    } else if (text === '/help') {
      await sendMessage(
        chatId,
        'یه لینک مستقیم دانلود بفرست (باید با http یا https شروع بشه).\n\nمثال:\n`https://example.com/photo.jpg`\n\nنوع فایل (عکس/ویدیو/موزیک/PDF) رو خودکار تشخیص می‌دم.\n\n⚠️ توجه: فقط لینک‌های مستقیم به فایل کار می‌کنن، نه لینک صفحات وب یا سایت‌های اشتراک‌گذاری.'
      );
    } else if (isValidUrl(text)) {
      await handleLink(chatId, text);
    } else {
      await sendMessage(chatId, 'این یه لینک معتبر نیست 🤔 لطفاً یه لینک که با http:// یا https:// شروع می‌شه بفرست.');
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(200).json({ ok: true });
  }
}

function isValidUrl(text) {
  try {
    const url = new URL(text);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

async function handleLink(chatId, url) {
  await sendChatAction(chatId, 'upload_document');

  const category = await detectCategory(url);
  const sent = await trySend(chatId, url, category);

  if (!sent) {
    // اگه روش تشخیصی جواب نداد، به‌عنوان فایل عمومی امتحان می‌کنیم
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
  // اول از روی پسوند لینک حدس می‌زنیم (سریع‌تره)
  const cleanPath = url.split('?')[0].split('#')[0];
  const ext = cleanPath.split('.').pop()?.toLowerCase();
  if (ext && EXTENSION_MAP[ext]) {
    return EXTENSION_MAP[ext];
  }

  // اگه از پسوند نفهمیدیم، با یه درخواست HEAD نوع فایل رو می‌پرسیم
  try {
    const headRes = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(8000) });
    const contentType = headRes.headers.get('content-type') || '';
    if (contentType.startsWith('image/')) return 'image';
    if (contentType.startsWith('video/')) return 'video';
    if (contentType.startsWith('audio/')) return 'audio';
    if (contentType === 'application/pdf') return 'document';
  } catch {
    // سرور مقصد از HEAD پشتیبانی نمی‌کنه، می‌ریم سراغ fallback
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
