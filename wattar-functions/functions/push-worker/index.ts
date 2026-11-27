import {
  HttpError,
  errorResponse,
  getSupabaseAdmin,
  hasPushWorkerKey,
  jsonResponse,
  requireServiceRoleOrAdmin,
} from '../_shared/supabase.ts';

/**
 * push-worker — عامل إرسال الإشعارات.
 *
 * يسحب من طابور `push_queue` (الذي يُغذّيه زناد
 * `trg_user_notifications_enqueue_push` بعد احترام تفضيلات المستخدم)،
 * يرسل عبر Expo Push API، ثم يعلّم النتائج عبر `finish_push_batch`.
 * التصميم يفصل «إنشاء الإشعار» عن «تسليمه» فتصبح إعادة المحاولة
 * وتنظيف الرموز البائدة ممكنة بلا فقدان أو تكرار.
 *
 * يُستدعى من: جدولة خارجية (cron/curl) بمفتاح service_role، أو من
 * لوحة الإدارة بجلسة موظف يملك notifications.manage.
 */

type QueueRow = {
  id: string;
  user_id: string;
  title: string;
  body: string;
  route: string | null;
  channel: string;
  attempts: number;
};

type PushToken = { user_id: string; expo_push_token: string };

type Ticket = {
  status?: string;
  details?: { error?: string };
};

interface WorkerRequest {
  limit?: number;
}

const BATCH = 100;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return jsonResponse({}, 200);
  if (req.method !== 'POST') return jsonResponse({ error: 'METHOD_NOT_ALLOWED' }, 405);

  try {
    if (!(await hasPushWorkerKey(req, 'push_worker_secret'))) {
      await requireServiceRoleOrAdmin(req, 'notifications.manage');
    }
    const body = (await req.json().catch(() => ({}))) as WorkerRequest;
    const limit = Number.isFinite(body.limit) ? Math.min(Math.max(Number(body.limit), 1), 200) : 100;

    const supabase = getSupabaseAdmin();
    const { data: claimed, error: claimError } = await supabase.rpc('claim_push_batch', { p_limit: limit });
    if (claimError) throw claimError;

    const rows = (Array.isArray(claimed) ? claimed : []) as QueueRow[];
    if (!rows.length) return jsonResponse({ claimed: 0, sent: 0, failed: 0 });

    const userIds = [...new Set(rows.map((row) => row.user_id))];

    const { data: tokenRows, error: tokenError } = await supabase
      .from('push_tokens')
      .select('user_id, expo_push_token')
      .in('user_id', userIds);
    if (tokenError) throw tokenError;

    const tokensByUser = new Map<string, string[]>();
    for (const token of (tokenRows ?? []) as PushToken[]) {
      const list = tokensByUser.get(token.user_id) ?? [];
      list.push(token.expo_push_token);
      tokensByUser.set(token.user_id, list);
    }

    const sentIds: string[] = [];
    const failed: Array<{ id: string; error: string }> = [];
    const messages: Array<{ to: string; queueId: string; title: string; body: string; route: string | null; channel: string }> = [];

    for (const row of rows) {
      const tokens = tokensByUser.get(row.user_id) ?? [];
      if (!tokens.length) {
        failed.push({ id: row.id, error: 'NoTokens' });
        continue;
      }
      for (const token of tokens) {
        messages.push({
          to: token,
          queueId: row.id,
          title: row.title,
          body: row.body,
          route: row.route,
          channel: row.channel,
        });
      }
    }

    const deliveredIds = new Set<string>();

    for (let offset = 0; offset < messages.length; offset += BATCH) {
      const batch = messages.slice(offset, offset + BATCH);
      const response = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'Accept-Encoding': 'gzip, deflate',
        },
        body: JSON.stringify(batch.map((item) => ({
          to: item.to,
          title: item.title,
          body: item.body,
          sound: 'default',
          channelId: item.channel || 'social',
          priority: 'high',
          data: { route: item.route },
        }))),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new HttpError(502, 'PUSH_DELIVERY_FAILED', `Expo push failed: ${response.status} ${text.slice(0, 200)}`);
      }

      const result = await response.json();
      const tickets: Ticket[] = Array.isArray(result?.data) ? result.data : [];
      const invalidTokens: string[] = [];

      tickets.forEach((ticket, index) => {
        const item = batch[index];
        if (!item) return;
        if (ticket.status === 'ok') {
          deliveredIds.add(item.queueId);
          return;
        }
        const errorCode = ticket.details?.error ?? 'Unknown';
        failed.push({ id: item.queueId, error: errorCode });
        if (errorCode === 'DeviceNotRegistered') invalidTokens.push(item.to);
      });

      if (tickets.length < batch.length) {
        for (const item of batch.slice(tickets.length)) {
          failed.push({ id: item.queueId, error: 'MissingTicket' });
        }
      }

      if (invalidTokens.length) {
        const { error } = await supabase.from('push_tokens').delete().in('expo_push_token', invalidTokens);
        if (error) throw error;
      }
    }

    // أي صف فشل في كل رموزه يُعلَّم فاشلاً؛ النجاح في رمز واحد يكفي
    const failedOnly = failed.filter((item) => !deliveredIds.has(item.id));

    const { error: finishError } = await supabase.rpc('finish_push_batch', {
      p_sent_ids: [...deliveredIds],
      p_failed: failedOnly,
    });
    if (finishError) throw finishError;

    return jsonResponse({
      claimed: rows.length,
      sent: deliveredIds.size,
      failed: failedOnly.length,
    });
  } catch (error) {
    return errorResponse(error);
  }
});
