import { query } from '@/lib/db';
import { config } from '@/lib/config';

export type Mail = {
  to: string;
  subject: string;
  body: string;
  requestId?: string | null;
  kind: 'verify_email' | 'authorization_pending' | 'snapshot_ready' | 'reviewer_alert';
};

/**
 * Every message is written to `email_outbox` first and sent from there by the
 * worker. Until a TCecure sending identity exists the outbox is the delivery
 * record, and nothing is sent — no other domain's relay is used in its place.
 */
export async function enqueueMail(mail: Mail): Promise<void> {
  await query(
    `INSERT INTO email_outbox (request_id, template, to_address, subject, body_text, transport, status)
          VALUES ($1, $2, $3, $4, $5, $6, 'pending')`,
    [
      mail.requestId ?? null,
      mail.kind,
      mail.to,
      mail.subject,
      mail.body,
      process.env.MAIL_TRANSPORT ?? 'log',
    ],
  );
}

const SIGNOFF = `
TCecure
Cyber risk, compliance and assessment services
https://tcecure.com
`;

export function verifyEmailBody(contactName: string, business: string, link: string): string {
  return `Hello ${contactName},

You asked TCecure for a free External Exposure Snapshot for ${business}.

Confirm this address to continue:
${link}

The link stops working in ${config.verifyTokenTtlHours()} hours. If you did not ask for
this review, ignore this message and nothing further happens — no review is
performed until the address is confirmed and control of the website is proven.
${SIGNOFF}`;
}

export function snapshotReadyBody(contactName: string, business: string, link: string, hours: number): string {
  return `Hello ${contactName},

Your External Exposure Snapshot for ${business} has been reviewed by a TCecure
analyst and is ready.

Read it here (private link, expires in ${hours} hours):
${link}

The briefing records what is publicly observable about your website and email
domain at the time it was reviewed. It is a limited public review, not a
penetration test or a comprehensive vulnerability assessment. Reply to this
message if you would like to discuss a full assessment.
${SIGNOFF}`;
}
