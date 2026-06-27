export interface LinkDestination {
  url: string;
  title?: string;
}

export function extractLinkDestination(raw: string): LinkDestination | undefined {
  const s = raw.trim();
  if (s.length === 0) return undefined;

  let url: string;
  let rest: string;

  if (s.startsWith('<')) {
    const end = s.indexOf('>');
    if (end === -1) return undefined;
    url = s.slice(1, end).trim();
    if (!url) return undefined;
    rest = s.slice(end + 1).trim();
  } else {
    const m = /^(\S+)/.exec(s);
    if (!m) return undefined;
    url = m[1];
    rest = s.slice(m[0].length).trim();
  }

  let title: string | undefined;
  if (rest.length > 0) {
    const tm = /^(?:"([^"]*)"|'([^']*)'|\(([^)]*)\))$/.exec(rest);
    if (tm) title = tm[1] ?? tm[2] ?? tm[3];
  }

  return { url, title };
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
