// Simple CSV/JSON parser capped at 200 records
export function parseInputString(inputStr) {
  const trimmed = inputStr.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const json = JSON.parse(trimmed);
      if (Array.isArray(json)) return json.slice(0, 200);
      return [json];
    } catch (e) {
      // fallthrough to CSV attempt
    }
  }
  return parseCSV(trimmed).slice(0, 200);
}

function parseCSV(text) {
  // naive CSV parser with quote support for simple cases
  const lines = text.split(/\r?\n/).filter(l => l.length > 0);
  if (lines.length === 0) return [];
  const headers = splitCsvLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    const row = {};
    headers.forEach((h, idx) => { row[h] = cols[idx]; });
    rows.push(row);
  }
  return rows;
}

function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i+1] === '"') { cur += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (c === ',' && !inQuotes) {
      out.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out.map(s => s.trim());
}

export function inferType(value) {
  if (value === null || value === undefined || value === '') return 'empty';
  if (!isNaN(Number(value))) return 'number';
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return 'date';
  return 'text';
}
