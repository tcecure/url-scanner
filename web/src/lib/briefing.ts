/**
 * The briefing HTML is rendered by the worker before a reviewer has seen it, so
 * the reviewer's summary is written into the stored document at approval time.
 * The worker leaves a marker where the section belongs; a document without one
 * (an older report) is returned unchanged rather than patched by guesswork.
 */
const MARKER = '<!--tce:reviewer-summary-->';

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function withReviewerSummary(html: string, notes: string): string {
  if (!notes.trim() || !html.includes(MARKER)) return html;
  const paragraphs = notes
    .trim()
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`)
    .join('\n');
  return html.replace(MARKER, `<h2>Reviewer's summary</h2>\n${paragraphs}`);
}
