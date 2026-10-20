import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { verifyEmailBody, staffAuthorizationBody } from '../src/lib/mail';
import { submissionSchema } from '../src/lib/requests';
import { emailMatchesTarget } from '../src/lib/target';

const src = (...parts: string[]) => join(__dirname, '..', 'src', ...parts);
const read = (...parts: string[]) => readFileSync(src(...parts), 'utf8');

const LANDING = ['app', 'page.tsx'];
const STATUS = ['app', 'status', '[token]', 'page.tsx'];
const PRIVACY = ['app', 'privacy', 'page.tsx'];
const FORM = ['components', 'RequestForm.tsx'];
const CUSTOMER_PAGES = [LANDING, STATUS, ['app', 'verify', '[token]', 'page.tsx'], PRIVACY, FORM];

describe('the submission form', () => {
  it('still refuses a submission without the authorization statement', () => {
    const submission = {
      businessName: 'Example Manufacturing LLC',
      website: 'example.test',
      contactName: 'Dana Reyes',
      contactEmail: 'dana@example.test',
      marketingConsent: false,
    };
    expect(submissionSchema.safeParse(submission).success).toBe(false);
    expect(submissionSchema.safeParse({ ...submission, authorization: false }).success).toBe(false);
    expect(submissionSchema.safeParse({ ...submission, authorization: true }).success).toBe(true);
  });

  it('asks for nothing beyond the business, the site and how to reach someone', () => {
    const fields = Object.keys(submissionSchema.shape);
    expect(fields).toEqual([
      'businessName',
      'website',
      'contactName',
      'contactEmail',
      'authorization',
      'marketingConsent',
      'company_website',
      'formLoadedAt',
    ]);
  });
});

describe('the customer-facing pages', () => {
  it('never ask for a DNS record, a file or any change to the website', () => {
    for (const page of CUSTOMER_PAGES) {
      const text = read(...page);
      expect(text, page.join('/')).not.toMatch(/site-verification/i);
      expect(text, page.join('/')).not.toMatch(/\.well-known/i);
      expect(text, page.join('/')).not.toMatch(/TXT record/i);
      expect(text, page.join('/')).not.toMatch(/I've published it|I&apos;ve published it/i);
    }
  });

  it('never describe the customer as having proven control of the domain', () => {
    for (const page of CUSTOMER_PAGES) {
      const text = read(...page);
      expect(text, page.join('/')).not.toMatch(/prove (you )?control|proven control|control verified/i);
    }
  });

  it('keep the authorization checkbox and the review gate in the copy', () => {
    const form = read(...FORM);
    expect(form).toContain('name="authorization"');
    expect(form).toContain('required');
    expect(read(...LANDING)).toMatch(/analyst reviews the findings before anything is sent/i);
    expect(read(...PRIVACY)).toMatch(/no findings are released until/i);
  });

  it('tell an unclear request it is held for TCecure, with nothing to do', () => {
    const status = read(...STATUS);
    expect(status).toMatch(/reviewer is confirming your authorization/i);
    expect(status).toMatch(/nothing for you to publish or change/i);
  });

  it('describe only the public observations the worker makes', () => {
    const landing = read(...LANDING);
    expect(landing).toMatch(/Public DNS records/);
    expect(landing).toMatch(/SPF and DMARC/);
    expect(landing).toMatch(/No port scanning/);
    expect(landing).toMatch(/No crawling past your home page/);
  });
});

describe('the probing endpoint and button', () => {
  it('are gone, so no customer action can queue an authorization probe', () => {
    expect(existsSync(src('app', 'api', 'authorization', 'route.ts'))).toBe(false);
    expect(existsSync(src('components', 'AuthorizationCheck.tsx'))).toBe(false);
    expect(read('lib', 'requests.ts')).not.toContain('authorization_probe');
  });
});

describe('the mail copy', () => {
  it('asks only for the confirmation and claims no proof of control', () => {
    const body = verifyEmailBody('Dana Reyes', 'Example Manufacturing LLC', 'https://scan.tcecure.test/verify/x');
    expect(body).toMatch(/nothing to change on your\nwebsite or your DNS/);
    expect(body).not.toMatch(/control of the website/i);
    expect(body).not.toMatch(/TXT|well-known/i);
  });

  it('tells a reviewer what to confirm when the authorization is unclear', () => {
    const body = staffAuthorizationBody(
      'Example Manufacturing LLC',
      'example.test',
      'dana@contractor.test',
      'https://scan.tcecure.test/staff',
    );
    expect(body).toMatch(/held for an authorization decision/);
    expect(body).toMatch(/nothing has been observed/);
    expect(body).toContain('https://scan.tcecure.test/staff');
  });
});

describe('which requests are clear enough to run', () => {
  it('accepts the authorization of a work address on the domain under review', () => {
    expect(emailMatchesTarget('dana@example.test', 'example.test')).toBe(true);
    expect(emailMatchesTarget('dana@mail.example.test', 'example.test')).toBe(true);
  });

  it('holds anything else for a reviewer rather than assuming it', () => {
    expect(emailMatchesTarget('dana@contractor.test', 'example.test')).toBe(false);
    expect(emailMatchesTarget('dana@example.test.attacker.test', 'example.test')).toBe(false);
  });
});
