export function extractLinkDestination(raw: string): string | undefined {
  const s = raw.trim();
  if (s.length === 0) return undefined;
  if (s.startsWith('<')) {
    const end = s.indexOf('>');
    if (end === -1) return undefined;
    return s.slice(1, end).trim() || undefined;
  }
  const m = /^(\S+)/.exec(s);
  return m ? m[1] : undefined;
}

export function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[*_`~]/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-');
}

export function findHeadingLineBySlug(text: string, anchor: string): number | undefined {
  const target = anchor.toLowerCase();
  const lines = text.split(/\r?\n/);
  const headingRe = /^[ \t]*(?:\/\/+|\/\*+|\*+|--|;+|>)?[ \t]*(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/;
  for (let i = 0; i < lines.length; i++) {
    const m = headingRe.exec(lines[i]);
    if (m && slugify(m[2]) === target) return i;
  }
  return undefined;
}
