/**
 * Target acceptance rules for submitted websites.
 *
 * The worker enforces these again at connection time — this copy exists so a
 * prospect gets an immediate, plain answer instead of a queued job that fails.
 */

const BLOCKED_SUFFIXES = ['.local', '.internal', '.localdomain', '.lan', '.home.arpa'];
const NUMERIC_LABEL = /^(0[xX][0-9a-fA-F]+|[0-9]+)$/;
const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

export class TargetRejected extends Error {}

/** Reduce what someone typed into a bare hostname, or explain why we can't. */
export function normalizeDomain(input: string): string {
  const raw = (input ?? '').trim();
  if (!raw) throw new TargetRejected('Enter the website address for your business.');

  let url: URL;
  try {
    url = new URL(raw.includes('://') ? raw : `https://${raw}`);
  } catch {
    throw new TargetRejected('That does not look like a website address.');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TargetRejected('Only ordinary http and https websites can be reviewed.');
  }
  if (url.username || url.password) {
    throw new TargetRejected('Remove the username and password from the address.');
  }
  if (url.port && url.port !== '80' && url.port !== '443') {
    throw new TargetRejected('Only the standard web ports (80 and 443) are reviewed.');
  }

  const host = url.hostname.toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
  if (!host) throw new TargetRejected('That address has no website name in it.');
  if (host.includes(':')) {
    throw new TargetRejected('An IP address is not an acceptable target; enter your domain name.');
  }

  const labels = host.split('.');
  if (labels.every((label) => NUMERIC_LABEL.test(label))) {
    throw new TargetRejected('An IP address is not an acceptable target; enter your domain name.');
  }
  if (labels.length < 2) {
    throw new TargetRejected('Enter your full public domain name, for example example.com.');
  }
  if (BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix)) || host === 'localhost') {
    throw new TargetRejected('Internal names cannot be reviewed; enter your public domain name.');
  }
  if (host.length > 253 || !labels.every((label) => LABEL.test(label))) {
    throw new TargetRejected('That domain name is not valid.');
  }
  const tld = labels[labels.length - 1];
  if (tld.length < 2 || /[0-9]/.test(tld)) {
    throw new TargetRejected('That domain name is not valid.');
  }
  // SPF and DMARC are published on the domain, not on its www alias, and the
  // site check follows the redirect between them either way.
  if (labels.length > 2 && labels[0] === 'www') return labels.slice(1).join('.');
  return host;
}

/** Work email only: free mailbox providers cannot establish who authorized a review. */
const CONSUMER_MAIL = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'ymail.com', 'hotmail.com', 'outlook.com',
  'live.com', 'msn.com', 'aol.com', 'icloud.com', 'me.com', 'mac.com', 'proton.me',
  'protonmail.com', 'gmx.com', 'mail.com', 'zoho.com', 'yandex.com', 'tutanota.com',
]);

export function isConsumerMailbox(email: string): boolean {
  const domain = email.split('@')[1]?.toLowerCase() ?? '';
  return CONSUMER_MAIL.has(domain);
}

export function emailDomain(email: string): string {
  return email.split('@')[1]?.toLowerCase() ?? '';
}

/**
 * Does the work email belong to the domain being reviewed?
 *
 * A match is not proof of authority. It decides whether the authorization the
 * requester gave on the form is clear enough to act on, or whether the request
 * is held for a TCecure reviewer to confirm with the business.
 */
export function emailMatchesTarget(email: string, domain: string): boolean {
  const mailDomain = emailDomain(email);
  if (!mailDomain) return false;
  return mailDomain === domain || mailDomain.endsWith(`.${domain}`) || domain.endsWith(`.${mailDomain}`);
}
