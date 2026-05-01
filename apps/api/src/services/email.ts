import { Resend } from 'resend';

let resend: Resend | null = null;

function getResendClient(): Resend {
  const apiKey = process.env['RESEND_API_KEY'];
  if (!apiKey) {
    throw new Error('RESEND_API_KEY is not set');
  }
  resend ??= new Resend(apiKey);
  return resend;
}

function getFromEmail(): string {
  const from = process.env['RESEND_FROM_EMAIL'];
  if (!from) {
    throw new Error('RESEND_FROM_EMAIL is not set');
  }
  return from;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function shouldExposeDevEmailOtp(): boolean {
  return process.env['NODE_ENV'] !== 'production';
}

export async function sendEmailOtp(input: {
  email: string;
  code: string;
  ttlMinutes: number;
  purpose: 'login' | 'bind_email';
}): Promise<{ sent: boolean; providerId?: string }> {
  const configured = Boolean(process.env['RESEND_API_KEY'] && process.env['RESEND_FROM_EMAIL']);
  if (!configured && shouldExposeDevEmailOtp()) {
    console.info(`[Email OTP] ${input.email} ${input.purpose} code: ${input.code}`);
    return { sent: false };
  }

  const subject =
    input.purpose === 'bind_email'
      ? 'Verify your Agon email'
      : 'Your Agon sign-in code';
  const safeCode = escapeHtml(input.code);
  const safeMinutes = escapeHtml(String(input.ttlMinutes));
  const html = [
    '<div style="font-family:Inter,Arial,sans-serif;line-height:1.5;color:#111827">',
    '<h1 style="font-size:20px;margin:0 0 16px">Agon Arena verification</h1>',
    `<p>Your verification code is:</p>`,
    `<p style="font-size:28px;letter-spacing:6px;font-weight:700;margin:20px 0">${safeCode}</p>`,
    `<p>This code expires in ${safeMinutes} minutes. If you did not request it, ignore this email.</p>`,
    '</div>',
  ].join('');

  const result = await getResendClient().emails.send({
    from: getFromEmail(),
    to: [input.email],
    subject,
    text: `Your Agon Arena verification code is ${input.code}. It expires in ${input.ttlMinutes} minutes.`,
    html,
  });

  if (result.error) {
    throw new Error(result.error.message);
  }

  return { sent: true, providerId: result.data?.id };
}
