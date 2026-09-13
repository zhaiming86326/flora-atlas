import { createReadStream, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const [, , inputPath = 'wcvp-backbone-import.sql', outputPath = 'db/import/wiki-enrichment-targets.csv'] = process.argv;
const headers = ['taxon_id', 'lookup_name', 'scientific_name', 'authorship', 'taxon_rank', 'family', 'genus', 'chinese_name'];

function parseSqlValues(line) {
  const marker = 'VALUES(';
  const start = line.indexOf(marker);
  if (start === -1 || !line.endsWith(');')) return null;
  const source = line.slice(start + marker.length, -2);
  const values = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === "'" && source[index + 1] === "'") {
        value += "'";
        index += 1;
      } else if (char === "'") {
        quoted = false;
      } else {
        value += char;
      }
    } else if (char === "'") {
      quoted = true;
    } else if (char === ',') {
      values.push(value === 'NULL' ? '' : value);
      value = '';
    } else {
      value += char;
    }
  }
  values.push(value === 'NULL' ? '' : value);
  return values;
}

function csv(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const rows = [headers.join(',')];
let count = 0;
for await (const line of createInterface({ input: createReadStream(inputPath, 'utf8'), crlfDelay: Infinity })) {
  if (!line.startsWith('INSERT INTO "accepted_species_zh" VALUES(')) continue;
  const values = parseSqlValues(line);
  if (!values || values.length < 20) continue;
  const row = {
    taxon_id: values[0],
    lookup_name: values[3] || values[2],
    scientific_name: values[2],
    authorship: values[4],
    taxon_rank: values[5],
    family: values[9],
    genus: values[10],
    chinese_name: values[16],
  };
  rows.push(headers.map(header => csv(row[header])).join(','));
  count += 1;
}

writeFileSync(outputPath, `${rows.join('\n')}\n`);
console.log(`Wrote ${count} targets to ${outputPath}`);
