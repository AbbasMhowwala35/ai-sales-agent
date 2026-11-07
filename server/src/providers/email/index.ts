import nodemailer from 'nodemailer';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';

export interface EmailMessage { to: string; subject: string; text: string; html?: string; attachments?: { filename: string; content: string; contentType?: string }[] }
export const sentEmails: EmailMessage[] = []; // inspectable in tests / dev console transport

let transporter: ReturnType<typeof nodemailer.createTransport> | null | undefined;
function getTransport() {
  if (transporter !== undefined) return transporter;
  transporter = env.SMTP_HOST
    ? nodemailer.createTransport({ host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_PORT === 465, auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined })
    : null;
  return transporter;
}

export async function sendEmail(msg: EmailMessage) {
  const t = getTransport();
  if (!t) {
    sentEmails.push(msg);
    if (sentEmails.length > 100) sentEmails.shift();
    logger.info({ to: msg.to, subject: msg.subject }, 'email (console transport — set SMTP_HOST to deliver)');
    return { delivered: false };
  }
  await t.sendMail({ from: env.EMAIL_FROM, ...msg });
  return { delivered: true };
}
