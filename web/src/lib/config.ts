function env(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) throw new Error(`${name} is not configured`);
  return value;
}

export const config = {
  publicBaseUrl: () => env('PUBLIC_BASE_URL', 'https://scan.tcecure.com').replace(/\/$/, ''),
  mailFrom: () => env('MAIL_FROM', 'no-reply@tcecure.com'),
  reviewerInbox: () => env('REVIEWER_INBOX', 'reviews@tcecure.com'),
  reportLinkTtlHours: () => Number(env('REPORT_LINK_TTL_HOURS', '72')),
  verifyTokenTtlHours: () => Number(env('VERIFY_TOKEN_TTL_HOURS', '48')),
  retentionDays: () => Number(env('RETENTION_DAYS', '90')),
  maxRequestsPerEmailPerDay: () => Number(env('MAX_REQUESTS_PER_EMAIL_PER_DAY', '3')),
  maxRequestsPerIpPerHour: () => Number(env('MAX_REQUESTS_PER_IP_PER_HOUR', '5')),
  maxRequestsPerDomainPerWeek: () => Number(env('MAX_REQUESTS_PER_DOMAIN_PER_WEEK', '2')),
  minFormSeconds: () => Number(env('MIN_FORM_SECONDS', '4')),
};
