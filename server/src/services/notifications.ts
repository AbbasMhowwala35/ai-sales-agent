import { Notification } from '../models/index.js';
import { sendEmail } from '../providers/email/index.js';

export async function notify(businessId: unknown, n: { userId?: unknown; type?: string; title: string; message?: string; link?: string; email?: string }) {
  const doc = await Notification.create({ businessId, userId: n.userId, type: n.type ?? 'info', title: n.title, message: n.message, link: n.link });
  if (n.email) await sendEmail({ to: n.email, subject: n.title, text: n.message ?? n.title }).catch(() => undefined);
  return doc;
}
