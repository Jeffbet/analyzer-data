const EMPTY_LABEL = '(vazio)';

const FTD_OPTIONAL_COLUMNS = ['ftd', 'saque', 'net'];
const CRM_OPTIONAL_COLUMNS = [
  'bonus_id',
  'bonus_template_name',
  'source_entity_name',
  'create_date',
  'bonus_cost_value',
  'bonus_amount',
];

export function normalizeId(value) {
  const text = String(value ?? '').replace(/^\uFEFF/, '').trim();
  if (!text) return '';

  const integerWithDecimal = text.match(/^([+-]?\d+)\.0+$/);
  return integerWithDecimal ? integerWithDecimal[1] : text;
}

export function parseBrlNumber(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return 0;

  let numeric = raw.replace(/[^\d,.-]/g, '');
  if (!numeric) return 0;

  if (numeric.includes(',')) {
    numeric = numeric.replace(/\./g, '').replace(',', '.');
  } else if (/^-?\d{1,3}(\.\d{3})+$/.test(numeric)) {
    numeric = numeric.replace(/\./g, '');
  }

  const number = Number(numeric);
  return Number.isFinite(number) ? number : 0;
}

export function parseFlexibleNumber(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return 0;

  const numeric = raw.replace(/[^\d,.-]/g, '');
  const commaIndex = numeric.lastIndexOf(',');
  const dotIndex = numeric.lastIndexOf('.');
  const decimalSeparator = commaIndex > dotIndex ? ',' : dotIndex > -1 ? '.' : '';
  let normalized = numeric;

  if (decimalSeparator) {
    const decimalIndex = decimalSeparator === ',' ? commaIndex : dotIndex;
    const integerPart = numeric.slice(0, decimalIndex).replace(/[.,]/g, '');
    const decimalPart = numeric.slice(decimalIndex + 1).replace(/[.,]/g, '');
    normalized = `${integerPart}.${decimalPart}`;
  }

  const number = Number(normalized);
  return Number.isFinite(number) ? number : 0;
}

export function analyzeFtdData(ftdTable, crmTable) {
  const ftdHeaders = new Set(ftdTable.headers);
  const crmHeaders = new Set(crmTable.headers);

  if (!ftdHeaders.has('id')) {
    throw new Error("No arquivo FTD nao encontrei a coluna obrigatoria 'ID'.");
  }

  if (!crmHeaders.has('user_ext_id')) {
    throw new Error("No arquivo CRM nao encontrei a coluna obrigatoria 'user_ext_id'.");
  }

  const warnings = [];
  for (const column of FTD_OPTIONAL_COLUMNS) {
    if (!ftdHeaders.has(column)) {
      warnings.push(`Base FTD sem a coluna opcional '${displayColumn(column)}'.`);
    }
  }

  for (const column of CRM_OPTIONAL_COLUMNS) {
    if (!crmHeaders.has(column)) {
      warnings.push(`Historico CRM sem a coluna opcional '${column}'.`);
    }
  }

  const useCampaignFallback = !crmHeaders.has('source_entity_name');
  if (useCampaignFallback) {
    warnings.push(
      "A coluna 'source_entity_name' nao existe. 'bonus_template_name' foi usado como campanha.",
    );
  }

  const ftdIds = new Set();
  for (const row of ftdTable.rows) {
    const id = normalizeId(row.id);
    if (id) ftdIds.add(id);
  }

  const matchedRows = [];
  const perId = new Map();
  const campaignImpact = new Map();
  const templateImpact = new Map();

  for (const row of crmTable.rows) {
    const id = normalizeId(row.user_ext_id);
    if (!id || !ftdIds.has(id)) continue;

    const campaign = cleanLabel(
      useCampaignFallback ? row.bonus_template_name : row.source_entity_name,
    );
    const template = cleanLabel(row.bonus_template_name);
    const amount = parseFlexibleNumber(row.bonus_amount);
    const cost = parseFlexibleNumber(row.bonus_cost_value);
    const date = parseDateValue(row.create_date);

    matchedRows.push({ id, campaign, template, amount, cost, date });
    updateImpact(campaignImpact, campaign, id, amount, cost);
    updateImpact(templateImpact, template, id, amount, cost);

    const metrics = perId.get(id) || createIdMetrics();
    metrics.totalReceipts += 1;
    metrics.campaigns.add(campaign);
    metrics.templates.add(template);
    metrics.totalAmount += amount;
    metrics.totalCost += cost;

    if (date.timestamp !== null) {
      if (metrics.firstTimestamp === null || date.timestamp < metrics.firstTimestamp) {
        metrics.firstTimestamp = date.timestamp;
        metrics.firstDate = date.label;
      }
      if (metrics.lastTimestamp === null || date.timestamp > metrics.lastTimestamp) {
        metrics.lastTimestamp = date.timestamp;
        metrics.lastDate = date.label;
      }
    }

    const campaignMetrics = metrics.campaignCounts.get(campaign) || {
      count: 0,
      latestTimestamp: null,
    };
    campaignMetrics.count += 1;
    if (
      date.timestamp !== null &&
      (campaignMetrics.latestTimestamp === null || date.timestamp > campaignMetrics.latestTimestamp)
    ) {
      campaignMetrics.latestTimestamp = date.timestamp;
    }
    metrics.campaignCounts.set(campaign, campaignMetrics);
    perId.set(id, metrics);
  }

  const resultById = ftdTable.rows
    .map((row, index) => buildIdResult(row, index, perId.get(normalizeId(row.id))))
    .sort(
      (a, b) =>
        b.ftdSortValue - a.ftdSortValue ||
        b.totalReceipts - a.totalReceipts ||
        a.originalIndex - b.originalIndex,
    )
    .map(({ ftdSortValue, originalIndex, ...row }) => row);

  const campaignRows = finalizeImpact(campaignImpact, 'campaign');
  const templateRows = finalizeImpact(templateImpact, 'template');
  const matchedFtdIds = new Set(matchedRows.map((row) => row.id));
  const uniqueFtdCount = ftdIds.size;

  return {
    summary: {
      ftdRows: ftdTable.rows.length,
      uniqueFtdIds: uniqueFtdCount,
      crmRows: crmTable.rows.length,
      matchedCrmRows: matchedRows.length,
      matchedFtdIds: matchedFtdIds.size,
      matchPercentage: uniqueFtdCount > 0 ? roundNumber((matchedFtdIds.size / uniqueFtdCount) * 100) : 0,
      topCampaign: campaignRows[0]?.campaign || '',
      topTemplate: templateRows[0]?.template || '',
    },
    campaignImpact: campaignRows,
    templateImpact: templateRows,
    resultById,
    warnings,
  };
}

function buildIdResult(row, originalIndex, metrics = createIdMetrics()) {
  const id = normalizeId(row.id);
  const topCampaign = pickTopCampaign(metrics.campaignCounts);
  const campaignNames = Array.from(metrics.campaigns);
  const templateNames = Array.from(metrics.templates);

  return {
    id,
    ftd: row.ftd ?? '',
    saque: row.saque ?? '',
    net: row.net ?? '',
    hasMatch: metrics.totalReceipts > 0 ? 'Sim' : 'Nao',
    totalReceipts: metrics.totalReceipts,
    distinctCampaigns: metrics.campaigns.size,
    distinctTemplates: metrics.templates.size,
    topCampaign: topCampaign.name,
    topCampaignReceipts: topCampaign.count,
    firstCampaign: metrics.firstDate,
    lastCampaign: metrics.lastDate,
    totalSpins: roundNumber(metrics.totalAmount),
    receivedCost: roundNumber(metrics.totalCost),
    campaignNames,
    templateNames,
    ftdSortValue: parseBrlNumber(row.ftd),
    originalIndex,
  };
}

function createIdMetrics() {
  return {
    totalReceipts: 0,
    campaigns: new Set(),
    templates: new Set(),
    campaignCounts: new Map(),
    totalAmount: 0,
    totalCost: 0,
    firstTimestamp: null,
    lastTimestamp: null,
    firstDate: '',
    lastDate: '',
  };
}

function pickTopCampaign(campaignCounts) {
  let selected = { name: '', count: 0, latestTimestamp: null };

  for (const [name, metrics] of campaignCounts) {
    const selectedTimestamp = selected.latestTimestamp ?? Number.NEGATIVE_INFINITY;
    const candidateTimestamp = metrics.latestTimestamp ?? Number.NEGATIVE_INFINITY;

    if (
      metrics.count > selected.count ||
      (metrics.count === selected.count && candidateTimestamp > selectedTimestamp) ||
      (metrics.count === selected.count &&
        candidateTimestamp === selectedTimestamp &&
        name.localeCompare(selected.name, 'pt-BR') < 0)
    ) {
      selected = { name, ...metrics };
    }
  }

  return selected;
}

function updateImpact(map, name, id, amount, cost) {
  const current = map.get(name) || {
    name,
    ids: new Set(),
    totalSends: 0,
    totalAmount: 0,
    totalCost: 0,
  };

  current.ids.add(id);
  current.totalSends += 1;
  current.totalAmount += amount;
  current.totalCost += cost;
  map.set(name, current);
}

function finalizeImpact(map, nameKey) {
  return Array.from(map.values())
    .map((row) => ({
      [nameKey]: row.name,
      impactedIds: row.ids.size,
      totalSends: row.totalSends,
      totalAmount: roundNumber(row.totalAmount),
      totalCost: roundNumber(row.totalCost),
    }))
    .sort(
      (a, b) =>
        b.impactedIds - a.impactedIds ||
        b.totalSends - a.totalSends ||
        a[nameKey].localeCompare(b[nameKey], 'pt-BR'),
    );
}

function parseDateValue(value) {
  const text = String(value ?? '').trim();
  if (!text) return { timestamp: null, label: '' };

  const brazilian = text.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/,
  );
  let date;

  if (brazilian) {
    date = new Date(
      Number(brazilian[3]),
      Number(brazilian[2]) - 1,
      Number(brazilian[1]),
      Number(brazilian[4] || 0),
      Number(brazilian[5] || 0),
      Number(brazilian[6] || 0),
    );
  } else {
    date = new Date(text);
  }

  if (Number.isNaN(date.getTime())) return { timestamp: null, label: '' };

  return {
    timestamp: date.getTime(),
    label: new Intl.DateTimeFormat('pt-BR', {
      dateStyle: 'short',
      timeStyle: text.match(/\d{1,2}:\d{2}/) ? 'short' : undefined,
    }).format(date),
  };
}

function cleanLabel(value) {
  const text = String(value ?? '').trim();
  return text || EMPTY_LABEL;
}

function displayColumn(column) {
  if (column === 'ftd') return 'FTD';
  if (column === 'saque') return 'Saque';
  return 'NET';
}

function roundNumber(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
