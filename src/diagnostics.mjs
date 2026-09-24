export function lineColumnAt(text, index) {
  const upto = String(text).slice(0, Math.max(0, index));
  const lines = upto.split('\n');
  return { line: lines.length, column: lines[lines.length - 1].length + 1 };
}

export function diagnostic(severity, code, message, file, line = 1, column = 1, hint = '') {
  return { severity, code, message, file, line, column, hint };
}

export function sortDiagnostics(diags) {
  const rank = { error: 0, warning: 1, info: 2 };
  return [...diags].sort((a, b) =>
    (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9) ||
    (a.file || '').localeCompare(b.file || '') ||
    a.line - b.line ||
    a.column - b.column ||
    a.code.localeCompare(b.code)
  );
}

export function formatDiagnostics(diags) {
  return sortDiagnostics(diags).map((d) => {
    const where = d.file ? d.file + ':' + d.line + ':' + d.column : 'line ' + d.line + ':' + d.column;
    const suffix = d.hint ? '\n  hint: ' + d.hint : '';
    return d.severity.toUpperCase() + ' ' + d.code + ' ' + where + ' - ' + d.message + suffix;
  }).join('\n');
}
