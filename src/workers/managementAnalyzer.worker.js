const METRICS = {
  deposits: ['deposito', 'depositos', 'deposit'],
  netPercent: ['net', 'net_percent', 'percentual_net'],
  netValue: ['valor', 'valor_net', 'net_depositos', 'net_deposito'],
  bonus: ['bonus'],
  registrations: ['registro_de_usuarios', 'registros_de_usuarios', 'usuarios_registrados', 'cadastros'],
  clubVip: ['clube_vip', 'club_vip'],
  referralBonus: ['bonus_de_indicacao', 'indicacao'],
  walletBalance: ['saldo_de_carteria', 'saldo_de_carteira', 'saldo_carteira'],
  casinoGgr: ['ggr_cassino', 'cassino_ggr'],
  sportsGgr: ['ggr_esportes', 'esportes_ggr'],
};

const DATE_ALIASES = ['data', 'date', 'dia'];
const HOUR_ALIASES = ['hora_a_hora', 'hora', 'horario', 'time'];
const BRAND_ALIASES = ['marca', 'operadora', 'brand', 'crm_brand_name'];

self.onmessage = async (event) => {
  try {
    const { file, referenceDate } = event.data;
    if (!file) throw new Error('Selecione um arquivo CSV para processar.');
    if (!file.name.toLowerCase().endsWith('.csv')) {
      throw new Error('Formato nao suportado. Selecione um arquivo CSV.');
    }

    const text = await readFile(file);
    const delimiter = detectDelimiter(text.slice(0, 65536));
    const rows = parseCsv(text, delimiter);
    const result = analyzeRows(rows, referenceDate, file.name);
    self.postMessage({ type: 'done', payload: result });
  } catch (error) {
    self.postMessage({
      type: 'error',
      payload: { message: error?.message || 'Nao foi possivel analisar o CSV.' },
    });
  }
};

async function readFile(file) {
  const chunks = [];
  let loadedBytes = 0;
  for await (const chunk of file.stream()) {
    chunks.push(chunk);
    loadedBytes += chunk.byteLength;
    self.postMessage({
      type: 'progress',
      payload: { loadedBytes, totalBytes: file.size },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  const merged = new Uint8Array(loadedBytes);
  let offset = 0;
  chunks.forEach((chunk) => {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  });
  return new TextDecoder('utf-8').decode(merged);
}

function analyzeRows(rows, referenceDate, fileName) {
  const headerInfo = findHeader(rows);
  if (!headerInfo) {
    throw new Error(
      'Formato nao reconhecido. Use um CSV gerencial com Hora/Deposito/GGR ou um historico com bonus_amount, bonus_cost_value e create_date.',
    );
  }

  return headerInfo.type === 'bonus'
    ? analyzeBonusHistory(rows.slice(headerInfo.index + 1), headerInfo.headers, fileName)
    : analyzeManagement(rows.slice(headerInfo.index + 1), headerInfo.headers, referenceDate, fileName);
}

function findHeader(rows) {
  const limit = Math.min(rows.length, 30);
  for (let index = 0; index < limit; index += 1) {
    const headers = rows[index].map(normalizeHeader);
    if (
      headers.includes('bonus_amount') &&
      headers.includes('bonus_cost_value') &&
      headers.some((header) => ['create_date', 'bonus_create_date', 'operational_create_date'].includes(header))
    ) {
      return { type: 'bonus', index, headers };
    }

    const recognizedMetrics = Object.values(METRICS).filter((aliases) =>
      aliases.some((alias) => headers.includes(alias)),
    ).length;
    const hasTime = HOUR_ALIASES.some((alias) => headers.includes(alias));
    if (recognizedMetrics >= 2 && hasTime) return { type: 'management', index, headers };
  }
  return null;
}

function analyzeBonusHistory(rows, headers, fileName) {
  const indexes = {
    date: findIndex(headers, ['create_date', 'bonus_create_date', 'operational_create_date']),
    amount: headers.indexOf('bonus_amount'),
    cost: headers.indexOf('bonus_cost_value'),
    brand: findIndex(headers, ['crm_brand_name', 'ext_brand_id']),
    campaign: findIndex(headers, ['source_entity_name', 'bonus_template_name']),
    type: findIndex(headers, ['bonus_type', 'ext_template_name']),
  };
  const buckets = new Map();
  let validRows = 0;
  let ignoredRows = 0;

  rows.forEach((row) => {
    if (row.length <= 1 && !String(row[0] || '').trim()) return;
    const dateParts = parseDateTime(row[indexes.date]);
    if (!dateParts) {
      ignoredRows += 1;
      return;
    }
    const cutoffHour = dateParts.minute <= 50 ? dateParts.hour : dateParts.hour + 1;
    if (cutoffHour > 23) {
      ignoredRows += 1;
      return;
    }
    const brand = clean(row[indexes.brand]) || 'Marca nao informada';
    const key = `${dateParts.date}|${brand}`;
    if (!buckets.has(key)) {
      buckets.set(key, Array.from({ length: 24 }, () => ({ promotionCost: 0, spinsAwarded: 0, cashback: 0, bonusRows: 0 })));
    }
    const amount = parseNumber(row[indexes.amount]);
    const cost = parseNumber(row[indexes.cost]);
    const text = `${clean(row[indexes.campaign])} ${clean(row[indexes.type])}`.toLowerCase();
    const cashback = text.includes('cashback');
    const bucket = buckets.get(key)[cutoffHour];
    bucket.promotionCost += amount * cost;
    bucket.bonusRows += 1;
    if (cashback) bucket.cashback += amount;
    else bucket.spinsAwarded += amount;
    validRows += 1;
  });

  if (!validRows) throw new Error('O CSV foi reconhecido, mas nenhuma data valida foi encontrada.');

  const points = [];
  buckets.forEach((hours, key) => {
    const [date, brand] = key.split('|');
    const cumulative = { promotionCost: 0, spinsAwarded: 0, cashback: 0, bonusRows: 0 };
    hours.forEach((values, hour) => {
      Object.keys(cumulative).forEach((metric) => { cumulative[metric] += values[metric]; });
      points.push({ date, hour, time: `${String(hour).padStart(2, '0')}:50`, brand, ...cumulative });
    });
  });

  return finalize({
    schemaType: 'bonus',
    fileName,
    points,
    sourceRows: validRows,
    warnings: [
      'Este arquivo contem somente historico de bonus. Depositos, Net, registros, saldo e GGR nao estao presentes e ficam indisponiveis.',
      ...(ignoredRows ? [`${ignoredRows} linha(s) sem data utilizavel ou posteriores ao corte das 23:50 foram ignoradas.`] : []),
    ],
    availableMetrics: ['promotionCost', 'spinsAwarded', 'cashback', 'bonusRows'],
  });
}

function analyzeManagement(rows, headers, referenceDate, fileName) {
  const indexes = {
    date: findIndex(headers, DATE_ALIASES),
    hour: findIndex(headers, HOUR_ALIASES),
    brand: findIndex(headers, BRAND_ALIASES),
  };
  Object.entries(METRICS).forEach(([metric, aliases]) => { indexes[metric] = findIndex(headers, aliases); });
  const availableMetrics = Object.keys(METRICS).filter((metric) => indexes[metric] >= 0);
  const fallbackDate = normalizeReferenceDate(referenceDate);
  const points = [];
  let ignoredRows = 0;

  rows.forEach((row) => {
    const hour = parseHour(row[indexes.hour]);
    if (hour === null) {
      if (row.some((cell) => clean(cell))) ignoredRows += 1;
      return;
    }
    const date = indexes.date >= 0 ? parseDateOnly(row[indexes.date]) : fallbackDate;
    if (!date) {
      ignoredRows += 1;
      return;
    }
    const point = {
      date,
      hour,
      time: `${String(hour).padStart(2, '0')}:50`,
      brand: clean(row[indexes.brand]) || 'Geral',
    };
    availableMetrics.forEach((metric) => { point[metric] = parseNumber(row[indexes[metric]]); });
    points.push(point);
  });

  if (!points.length) {
    throw new Error(
      indexes.date < 0 && !fallbackDate
        ? 'Informe a data de referencia deste CSV, pois ele possui horarios mas nao possui uma coluna Data.'
        : 'Nenhuma linha horaria valida foi encontrada no CSV gerencial.',
    );
  }

  return finalize({
    schemaType: 'management',
    fileName,
    points,
    sourceRows: points.length,
    warnings: ignoredRows ? [`${ignoredRows} linha(s) sem data ou horario validos foram ignoradas.`] : [],
    availableMetrics,
  });
}

function finalize(result) {
  const points = result.points.sort((a, b) =>
    a.date.localeCompare(b.date) || a.hour - b.hour || a.brand.localeCompare(b.brand),
  );
  return {
    ...result,
    points,
    dates: [...new Set(points.map((point) => point.date))],
    brands: [...new Set(points.map((point) => point.brand))].sort((a, b) => a.localeCompare(b, 'pt-BR')),
  };
}

function parseCsv(text, delimiter) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === delimiter) { row.push(field); field = ''; }
    else if (char === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
    else field += char;
  }
  if (field || row.length) { row.push(field.replace(/\r$/, '')); rows.push(row); }
  return rows;
}

function detectDelimiter(text) {
  const delimiters = [',', ';', '\t'];
  const maximums = new Map(delimiters.map((delimiter) => [delimiter, 0]));
  let quoted = false;
  let lineCounts = new Map(delimiters.map((delimiter) => [delimiter, 0]));
  let logicalLines = 0;

  for (let index = 0; index < text.length && logicalLines < 30; index += 1) {
    const char = text[index];
    if (char === '"' && quoted && text[index + 1] === '"') { index += 1; continue; }
    if (char === '"') { quoted = !quoted; continue; }
    if (!quoted && delimiters.includes(char)) lineCounts.set(char, lineCounts.get(char) + 1);
    if (!quoted && char === '\n') {
      delimiters.forEach((delimiter) => maximums.set(delimiter, Math.max(maximums.get(delimiter), lineCounts.get(delimiter))));
      lineCounts = new Map(delimiters.map((delimiter) => [delimiter, 0]));
      logicalLines += 1;
    }
  }
  delimiters.forEach((delimiter) => maximums.set(delimiter, Math.max(maximums.get(delimiter), lineCounts.get(delimiter))));
  return delimiters.sort((a, b) => maximums.get(b) - maximums.get(a))[0];
}

function normalizeHeader(value) {
  return clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function findIndex(headers, aliases) {
  for (const alias of aliases) {
    const index = headers.indexOf(alias);
    if (index >= 0) return index;
  }
  return -1;
}

function parseNumber(value) {
  let text = clean(value).replace(/R\$/gi, '').replace(/%/g, '').replace(/\s/g, '');
  if (!text) return 0;
  const negative = text.startsWith('-') || (text.startsWith('(') && text.endsWith(')'));
  text = text.replace(/[()\-+]/g, '');
  const lastComma = text.lastIndexOf(',');
  const lastDot = text.lastIndexOf('.');
  if (lastComma > lastDot) text = text.replace(/\./g, '').replace(',', '.');
  else if (lastDot > lastComma && lastComma >= 0) text = text.replace(/,/g, '');
  else if (lastComma >= 0) text = text.replace(',', '.');
  const number = Number.parseFloat(text.replace(/[^0-9.]/g, ''));
  return Number.isFinite(number) ? (negative ? -number : number) : 0;
}

function parseDateTime(value) {
  const text = clean(value);
  let match = text.match(/^(\d{2})\/(\d{2})\/(\d{4})[ T](\d{1,2}):(\d{2})/);
  if (match) return { date: `${match[3]}-${match[2]}-${match[1]}`, hour: Number(match[4]), minute: Number(match[5]) };
  match = text.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})/);
  if (match) return { date: `${match[1]}-${match[2]}-${match[3]}`, hour: Number(match[4]), minute: Number(match[5]) };
  return null;
}

function parseDateOnly(value) {
  const text = clean(value);
  let match = text.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (match) return `${match[3]}-${match[2]}-${match[1]}`;
  match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : '';
}

function normalizeReferenceDate(value) { return /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? value : ''; }

function parseHour(value) {
  const match = clean(value).match(/^(\d{1,2})(?::\d{2})?/);
  if (!match) return null;
  const hour = Number(match[1]);
  return hour >= 0 && hour <= 23 ? hour : null;
}

function clean(value) { return String(value ?? '').replace(/^\uFEFF/, '').trim(); }
