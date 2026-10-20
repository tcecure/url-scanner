import { describe, expect, it } from 'vitest';

import { withReviewerSummary } from '../src/lib/briefing';

const doc = '<h1>Snapshot</h1>\n<!--tce:reviewer-summary-->\n<h2>DNS</h2>';

describe('withReviewerSummary', () => {
  it('writes the summary where the worker left the marker', () => {
    const html = withReviewerSummary(doc, 'Two items need attention.');
    expect(html).toContain("<h2>Reviewer's summary</h2>");
    expect(html).toContain('<p>Two items need attention.</p>');
    expect(html).not.toContain('tce:reviewer-summary');
  });

  it('escapes reviewer text and keeps paragraph breaks', () => {
    const html = withReviewerSummary(doc, 'First <b>line</b>\n\nSecond & last');
    expect(html).toContain('<p>First &lt;b&gt;line&lt;/b&gt;</p>');
    expect(html).toContain('<p>Second &amp; last</p>');
  });

  it('falls back to the first findings section for a report rendered without the marker', () => {
    const html = withReviewerSummary('<h1>Snapshot</h1>\n<h2>DNS</h2>', 'Looks fine.');
    expect(html).toBe("<h1>Snapshot</h1>\n<h2>Reviewer's summary</h2>\n<p>Looks fine.</p>\n<h2>DNS</h2>");
  });

  it('leaves the document alone when there is no summary or nowhere to put it', () => {
    expect(withReviewerSummary(doc, '   ')).toBe(doc);
    expect(withReviewerSummary('<h1>Old report</h1>', 'notes')).toBe('<h1>Old report</h1>');
  });
});
