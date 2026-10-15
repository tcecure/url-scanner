import { describe, expect, it } from 'vitest';

import { TargetRejected, emailMatchesTarget, isConsumerMailbox, normalizeDomain } from '../src/lib/target';

/**
 * The web tier's validation is the first of two gates; the worker revalidates at
 * connection time. These cases are the ones a form should never let through.
 */
describe('normalizeDomain', () => {
  it('accepts an ordinary domain in the shapes people type', () => {
    for (const input of [
      'example.com',
      'https://example.com',
      'http://example.com/',
      'https://www.example.com/pricing?utm=1',
      '  Example.COM  ',
      'www.example.com',
    ]) {
      expect(normalizeDomain(input), input).toBe('example.com');
    }
  });

  it('keeps a subdomain that is not www', () => {
    expect(normalizeDomain('https://shop.example.com')).toBe('shop.example.com');
  });

  it('rejects addresses that are not a public website', () => {
    const rejected: Array<[string, RegExp]> = [
      ['', /website/i],
      ['localhost', /internal|public/i],
      ['127.0.0.1', /IP address/i],
      ['192.168.1.10', /IP address/i],
      ['[::1]', /IP address/i],
      ['2130706433', /IP address/i],
      ['0x7f000001', /IP address/i],
      ['017700000001', /IP address/i],
      ['user:pass@example.com', /username and password/i],
      ['https://example.com:8443', /port/i],
      ['ftp://example.com', /http/i],
      ['file:///etc/passwd', /http/i],
      ['server.local', /internal|public/i],
      ['host.internal', /internal|public/i],
      ['intranet', /full domain|public/i],
      ['example.123', /domain name|website address/i],
    ];
    for (const [input, pattern] of rejected) {
      let message = '';
      expect(() => {
        try {
          normalizeDomain(input);
        } catch (error) {
          message = error instanceof TargetRejected ? error.message : '';
          throw error;
        }
      }, input).toThrow(TargetRejected);
      expect(message, input).toMatch(pattern);
    }
  });
});

describe('mailbox checks', () => {
  it('treats free mailboxes as unable to prove authorization by email alone', () => {
    expect(isConsumerMailbox('someone@gmail.com')).toBe(true);
    expect(isConsumerMailbox('someone@outlook.com')).toBe(true);
    expect(isConsumerMailbox('someone@example.com')).toBe(false);
  });

  it('matches a work address against the requested domain, including subdomains', () => {
    expect(emailMatchesTarget('owner@example.com', 'example.com')).toBe(true);
    expect(emailMatchesTarget('owner@mail.example.com', 'example.com')).toBe(true);
    expect(emailMatchesTarget('owner@example.com', 'shop.example.com')).toBe(true);
    expect(emailMatchesTarget('owner@other.com', 'example.com')).toBe(false);
    expect(emailMatchesTarget('owner@notexample.com', 'example.com')).toBe(false);
  });
});
