import { analyzeFtdData } from '../modules/ftd/ftdAnalysis.js';

const FTD_COLUMNS = ['id', 'ftd', 'saque', 'net'];
const CRM_COLUMNS = [
  'user_ext_id',
  'bonus_id',
  'bonus_template_name',
  'source_entity_name',
  'create_date',
  'bonus_cost_value',
  'bonus_amount',
];

self.onmessage = async (event) => {
  if (event.data?.type !== 'process') return;

  try {
    const { ftdFile, crmFile } = event.data;
    validateFile(ftdFile, 'Base FTD / Metabase');
    validateFile(crmFile, 'Historico CRM');

    const totalBytes = ftdFile.size + crmFile.size;
    const ftdTable = await readCsvTable(ftdFile, FTD_COLUMNS, {
      phase: 'Lendo base FTD',
      byteOffset: 0,
      totalBytes,
    });
    const crmTable = await readCsvTable(crmFile, CRM_COLUMNS, {
      phase: 'Lendo historico CRM',
      byteOffset: ftdFile.size,
      totalBytes,
    });

    self.postMessage({
      type: 'progress',
      payload: {
        phase: 'Cruzando dados',
        loadedBytes: totalBytes,
        totalBytes,
        rows: ftdTable.rows.length + crmTable.rows.length,
      },
    });

    const results = analyzeFtdData(ftdTable, crmTable);
    self.postMessage({ type: 'done', payload: { results } });
  } catch (error) {
    self.postMessage({
      type: 'error',
      payload: {
        message: error?.message || 'Erro inesperado ao processar o cruzamento FTD.',
      },
    });
  }
};

function validateFile(file, label) {
  if (!file) throw new Error(`Selecione o arquivo de ${label}.`);

  const extension = file.name.toLowerCase().split('.').pop();
  if (extension === 'xlsx' || extension === 'xls') {
    throw new Error(
      `${label}: arquivos Excel nao estao habilitados nesta versao. Converta a planilha para CSV.`,
    );
  }
  if (extension !== 'csv') {
    throw new Error(`${label}: formato nao suportado. Selecione um arquivo CSV.`);
  }
}

async function readCsvTable(file, selectedColumns, progressContext) {
  const sampleBytes = await file.slice(0, 65536).arrayBuffer();
  const encoding = detectEncoding(sampleBytes);
  const sample = new TextDecoder(encoding).decode(sampleBytes);
  const delimiter = detectDelimiter(sample);
  const rows = [];
  let headers = [];
  let indexes = [];
  let isHeader = true;
  let loadedBytes = 0;
  let parsedRows = 0;
  let lastProgressAt = 0;
  const decoder = new TextDecoder(encoding);
  const parser = createCsvParser(delimiter, (row) => {
    if (isHeader) {
      headers = row.map(normalizeHeader);
      const columnMap = buildColumnMap(headers);
      indexes = selectedColumns.map((column) => [column, columnMap[column]]);
      isHeader = false;
      return;
    }

    if (row.length === 1 && row[0].trim() === '') return;

    const record = {};
    for (const [column, index] of indexes) {
      record[column] = index === undefined ? '' : String(row[index] ?? '').trim();
    }
    rows.push(record);
    parsedRows += 1;
  });

  for await (const chunk of file.stream()) {
    loadedBytes += chunk.byteLength;
    parser.push(decoder.decode(chunk, { stream: true }));

    const now = performance.now();
    if (now - lastProgressAt > 150) {
      lastProgressAt = now;
      self.postMessage({
        type: 'progress',
        payload: {
          phase: progressContext.phase,
          loadedBytes: progressContext.byteOffset + loadedBytes,
          totalBytes: progressContext.totalBytes,
          rows: parsedRows,
        },
      });
      await yieldToBrowser();
    }
  }

  parser.push(decoder.decode());
  parser.finish();

  if (headers.length === 0) {
    throw new Error(`Nao foi possivel ler o cabecalho de ${file.name}.`);
  }

  return { headers, rows };
}

function detectEncoding(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return 'utf-8';

  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return 'utf-8';
  } catch {
    return 'windows-1252';
  }
}

function detectDelimiter(text) {
  const firstLine = getFirstLogicalLine(text);
  const delimiters = [',', ';', '\t', '|'];
  let bestDelimiter = ',';
  let bestCount = -1;

  for (const delimiter of delimiters) {
    const count = countDelimiterOutsideQuotes(firstLine, delimiter);
    if (count > bestCount) {
      bestCount = count;
      bestDelimiter = delimiter;
    }
  }

  return bestDelimiter;
}

function getFirstLogicalLine(text) {
  let inQuotes = false;
  let line = '';

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (inQuotes && text[index + 1] === '"') {
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
    }

    if (!inQuotes && (char === '\n' || char === '\r')) break;
    line += char;
  }

  return line;
}

function countDelimiterOutsideQuotes(line, delimiter) {
  let count = 0;
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (!inQuotes && char === delimiter) {
      count += 1;
    }
  }

  return count;
}

function createCsvParser(delimiter, onRow) {
  let row = [];
  let field = '';
  let inQuotes = false;
  let pendingQuote = false;

  function endField() {
    row.push(field);
    field = '';
  }

  function endRow() {
    endField();
    onRow(row);
    row = [];
  }

  function handleChar(char) {
    while (true) {
      if (inQuotes) {
        if (pendingQuote) {
          if (char === '"') {
            field += '"';
            pendingQuote = false;
            return;
          }
          pendingQuote = false;
          inQuotes = false;
          continue;
        }

        if (char === '"') {
          pendingQuote = true;
          return;
        }
        field += char;
        return;
      }

      if (char === '"' && field.length === 0) {
        inQuotes = true;
      } else if (char === delimiter) {
        endField();
      } else if (char === '\n') {
        endRow();
      } else if (char !== '\r') {
        field += char;
      }
      return;
    }
  }

  return {
    push(text) {
      for (let index = 0; index < text.length; index += 1) handleChar(text[index]);
    },
    finish() {
      if (pendingQuote) {
        pendingQuote = false;
        inQuotes = false;
      }
      if (field.length > 0 || row.length > 0) endRow();
    },
  };
}

function normalizeHeader(header) {
  return String(header || '')
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase();
}

function buildColumnMap(headers) {
  return headers.reduce((map, header, index) => {
    if (header && map[header] === undefined) map[header] = index;
    return map;
  }, {});
}

function yieldToBrowser() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
