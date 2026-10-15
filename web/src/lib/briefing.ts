/**
 * The briefing HTML is rendered by the worker before a reviewer has seen it, so
 * the reviewer's summary is written into the stored document at approval time.
 * The worker leaves a marker where the section belongs; a document rendered
 * before the marker existed falls back to the same position in the template —
 * ahead of the first findings section.
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
  if (!notes.trim()) return html;
  const paragraphs = notes
    .trim()
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`)
    .join('\n');
  const section = `<h2>Reviewer's summary</h2>\n${paragraphs}`;

  if (html.includes(MARKER)) return html.replace(MARKER, section);
  const firstSection = html.indexOf('<h2>');
  if (firstSection === -1) return html;
  return `${html.slice(0, firstSection)}${section}\n${html.slice(firstSection)}`;
}
