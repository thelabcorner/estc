const DIRECTIVE_RE = /^\s*(#|\/\/@)(targetengine|target|includepath|include|strict)\b(.*)$/i;

export function scanAdobeDirectives(text) {
  const lines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/);
  const directives = [];
  for (let i = 0; i < lines.length; i++) {
    const m = DIRECTIVE_RE.exec(lines[i]);
    if (!m) continue;
    directives.push({
      line: i + 1,
      form: m[1],
      kind: m[2].toLowerCase(),
      argument: m[3].trim(),
      raw: lines[i]
    });
  }
  return directives;
}

export function stripAdobeDirectives(text) {
  const source = String(text).replace(/^\uFEFF/, '');
  const lines = source.split(/\r?\n/);
  const directives = [];
  for (let i = 0; i < lines.length; i++) {
    const m = DIRECTIVE_RE.exec(lines[i]);
    if (!m) continue;
    directives.push({
      line: i + 1,
      form: m[1],
      kind: m[2].toLowerCase(),
      argument: m[3].trim(),
      raw: lines[i]
    });
    lines[i] = '';
  }
  return { body: lines.join('\n'), directives };
}

export function firstMeaningfulLine(text) {
  const lines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim()) return { line: i + 1, text: lines[i] };
  }
  return { line: 1, text: '' };
}
