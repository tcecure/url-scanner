import { NextResponse, type NextRequest } from 'next/server';

/**
 * Content Security Policy.
 *
 * Next's bootstrap and hydration payloads are inline scripts, so a static
 * `script-src 'self'` serves a blank page: the document arrives but no script
 * runs. The policy is minted per request with a nonce instead, which Next picks
 * up from the request header and stamps onto its own script tags.
 * `strict-dynamic` covers the chunks those scripts load; `unsafe-inline` is
 * ignored by browsers that honour the nonce and is kept only for old ones.
 */
export function middleware(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-inline'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ');

  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce);
  headers.set('content-security-policy', csp);

  const response = NextResponse.next({ request: { headers } });
  response.headers.set('content-security-policy', csp);
  return response;
}

export const config = {
  matcher: [
    // Static assets and the briefing route are plain documents with no Next
    // runtime, so they need no nonce.
    {
      source: '/((?!_next/static|_next/image|favicon.ico|brand|r/).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
