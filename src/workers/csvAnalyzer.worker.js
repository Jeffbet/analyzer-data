const REQUIRED_COLUMNS = [
  'bonus_amount',
  'bonus_cost_value',
  'bonus_template_name',
  'source_entity_name',
];

const OPTIONAL_COLUMNS = ['bonus_type', 'ext_template_name'];
const FILTER_COLUMNS = ['crm_brand_name', 'bonus_status', 'bonus_type'];

let storedRows = [];
let storedWarnings = [];
let storedFilterOptions = createEmptyFilterOptions();

self.onmessage = async (event) => {
  try {
    const { file, filters, type } = event.data;

    if (type === 'filter') {
      if (storedRows.length === 0) {
        throw new Error('Carregue um CSV antes de aplicar filtros.');
      }

      const results = buildResults(filterRows(storedRows, filters), storedWarnings, storedFilterOptions);
      self.postMessage({
        type: 'filtered',
        payload: { results },
      });
      return;
    }

    if (!file) {
      throw new Error('Nenhum arquivo recebido para processamento.');
    }

    if (!file.name.toLowerCase().endsWith('.csv')) {
      throw new Error('Formato nao suportado nesta etapa. Importe um arquivo CSV.');
    }

    const results = await analyzeCsvFile(file);
    self.postMessage({
      type: 'done',
      payload: {
        results,
        progress: {
          loadedBytes: file.size,
          totalBytes: file.size,
          rows: results.summary.totalRows,
        },
      },
    });
  } catch (error) {
    self.postMessage({
      type: 'error',
      payload: {
        message: error?.message || 'Erro inesperado ao processar o CSV.',
      },
    });
  }
};

async function analyzeCsvFile(file) {
  storedRows = [];
  storedWarnings = [];
  storedFilterOptions = createEmptyFilterOptions();

  const sample = await file.slice(0, 65536).text();
  const delimiter = detectDelimiter(sample);
  const headerRow = await readHeader(file, delimiter);
  const headers = headerRow.map(normalizeHeader);
  const columnMap = buildColumnMap(headers);
  const missingRequired = REQUIRED_COLUMNS.filter((name) => columnMap[name] === undefined);

  if (missingRequired.length > 0) {
    throw new Error(
      `CSV sem colunas obrigatorias: ${missingRequired.join(', ')}. Confira se o arquivo contem bonus_amount, bonus_cost_value, bonus_template_name e source_entity_name.`,
    );
  }

  const warnings = OPTIONAL_COLUMNS.filter((name) => columnMap[name] === undefined).map(
    (name) => `Coluna opcional ausente: ${name}. A deteccao de cashback usara os campos disponiveis.`,
  );
  storedWarnings = warnings;

  const indexes = {
    amount: columnMap.bonus_amount,
    cost: columnMap.bonus_cost_value,
    template: columnMap.bonus_template_name,
    campaign: columnMap.source_entity_name,
    bonusType: columnMap.bonus_type,
    extTemplate: columnMap.ext_template_name,
    crmBrandName: columnMap.crm_brand_name,
    bonusStatus: columnMap.bonus_status,
  };

  let isHeader = true;
  let loadedBytes = 0;
  let parsedRows = 0;
  let lastProgressAt = 0;
  const decoder = new TextDecoder('utf-8');
  const parser = createCsvParser(delimiter, (row) => {
    if (isHeader) {
      isHeader = false;
      return;
    }

    if (row.length === 1 && row[0].trim() === '') return;
    parsedRows += 1;

    const templateName = cleanLabel(row[indexes.template]);
    const campaignName = cleanLabel(row[indexes.campaign]);
    const bonusType = indexes.bonusType === undefined ? '' : cleanText(row[indexes.bonusType]);
    const extTemplate = indexes.extTemplate === undefined ? '' : cleanText(row[indexes.extTemplate]);
    const crmBrandName =
      indexes.crmBrandName === undefined ? '' : cleanText(row[indexes.crmBrandName]);
    const bonusStatus =
      indexes.bonusStatus === undefined ? '' : cleanText(row[indexes.bonusStatus]);
    const amount = parseNumber(row[indexes.amount]);
    const cost = parseNumber(row[indexes.cost]);
    const isCashback = hasCashbackText([templateName, bonusType, extTemplate]);

    addFilterOption('crmBrandName', crmBrandName);
    addFilterOption('bonusStatus', bonusStatus);
    addFilterOption('bonusType', bonusType);

    storedRows.push({
      templateName,
      campaignName,
      bonusType,
      extTemplate,
      crmBrandName,
      bonusStatus,
      amount,
      cost,
      isCashback,
      searchText: normalizeSearchText([campaignName, templateName, bonusType, extTemplate].join(' ')),
    });
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
          loadedBytes,
          totalBytes: file.size,
          rows: parsedRows,
        },
      });
      await yieldToBrowser();
    }
  }

  parser.push(decoder.decode());
  parser.finish();
  storedFilterOptions = sortFilterOptions(storedFilterOptions);

  return buildResults(storedRows, warnings, storedFilterOptions);
}

function buildResults(rows, warnings, filterOptions) {
  const totals = {
    rows: 0,
    cost: 0,
    spinsWithoutCashback: 0,
    cashback: 0,
    cashbackRows: 0,
  };

  const uniqueTemplates = new Set();
  const uniqueCampaigns = new Set();
  const campaignCounts = new Map();
  const campaignAmounts = new Map();
  const templateCounts = new Map();
  const templateAmounts = new Map();
  const cashbackValues = new Map();
  const financialCostGroups = new Map();

  for (const row of rows) {
    totals.rows += 1;

    if (row.templateName !== '(vazio)') uniqueTemplates.add(row.templateName);
    if (row.campaignName !== '(vazio)') uniqueCampaigns.add(row.campaignName);

    totals.cost += row.cost;
    incrementMap(campaignCounts, row.campaignName, 1);
    incrementMap(campaignAmounts, row.campaignName, row.amount);
    incrementMap(templateCounts, row.templateName, 1);
    incrementMap(templateAmounts, row.templateName, row.amount);
    incrementFinancialCostGroup(financialCostGroups, row);

    if (row.isCashback) {
      totals.cashbackRows += 1;
      totals.cashback += row.amount;
      incrementMap(cashbackValues, row.templateName, row.amount);
    } else {
      totals.spinsWithoutCashback += row.amount;
    }
  }

  return {
    summary: {
      totalRows: totals.rows,
      uniqueTemplates: uniqueTemplates.size,
      uniqueCampaigns: uniqueCampaigns.size,
      totalCost: roundNumber(totals.cost),
      totalSpinsWithoutCashback: roundNumber(totals.spinsWithoutCashback),
      totalCashback: roundNumber(totals.cashback),
      cashbackRows: totals.cashbackRows,
    },
    topCampaignsByCount: mapToTopRows(campaignCounts),
    topCampaignsByAmount: mapToTopRows(campaignAmounts),
    topTemplatesByCount: mapToTopRows(templateCounts),
    topTemplatesByAmount: mapToTopRows(templateAmounts),
    topCashbackByValue: mapToTopRows(cashbackValues),
    topFinancialCostByCampaignTemplate: financialCostGroupsToTopRows(financialCostGroups),
    warnings,
    filterOptions,
  };
}

function filterRows(rows, filters = {}) {
  const search = normalizeSearchText(filters.search || '');
  const crmBrandName = filters.crmBrandName || '';
  const bonusStatus = filters.bonusStatus || '';
  const bonusType = filters.bonusType || '';

  return rows.filter((row) => {
    if (search && !row.searchText.includes(search)) return false;
    if (crmBrandName && row.crmBrandName !== crmBrandName) return false;
    if (bonusStatus && row.bonusStatus !== bonusStatus) return false;
    if (bonusType && row.bonusType !== bonusType) return false;
    return true;
  });
}

async function readHeader(file, delimiter) {
  let header = null;
  const decoder = new TextDecoder('utf-8');
  const parser = createCsvParser(delimiter, (row) => {
    if (!header) header = row;
  });

  for await (const chunk of file.slice(0, 262144).stream()) {
    parser.push(decoder.decode(chunk, { stream: true }));
    if (header) break;
  }

  if (!header) {
    parser.push(decoder.decode());
    parser.finish();
  }

  if (!header || header.length === 0) {
    throw new Error('Nao foi possivel ler o cabecalho do CSV.');
  }

  return header;
}

function detectDelimiter(text) {
  const firstLine = getFirstLogicalLine(text);
  const delimiters = [',', ';', '\t'];
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

    if (!inQuotes && (char === '\n' || char === '\r')) {
      break;
    }

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
      continue;
    }

    if (!inQuotes && char === delimiter) count += 1;
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
        return;
      }

      if (char === delimiter) {
        endField();
        return;
      }

      if (char === '\n') {
        endRow();
        return;
      }

      if (char === '\r') {
        return;
      }

      field += char;
      return;
    }
  }

  return {
    push(text) {
      for (let index = 0; index < text.length; index += 1) {
        handleChar(text[index]);
      }
    },
    finish() {
      if (pendingQuote) {
        pendingQuote = false;
        inQuotes = false;
      }

      if (field.length > 0 || row.length > 0) {
        endRow();
      }
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
    if (header && map[header] === undefined) {
      map[header] = index;
    }
    return map;
  }, {});
}

function cleanLabel(value) {
  const text = String(value ?? '').trim();
  return text || '(vazio)';
}

function cleanText(value) {
  return String(value ?? '').trim();
}

function parseNumber(value) {
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
  } else {
    normalized = numeric;
  }

  const number = Number(normalized);
  return Number.isFinite(number) ? number : 0;
}

function hasCashbackText(values) {
  return values
    .filter((value) => value !== undefined && value !== null)
    .join(' ')
    .toLowerCase()
    .includes('cashback');
}

function normalizeSearchText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function createEmptyFilterOptions() {
  return FILTER_COLUMNS.reduce((options, columnName) => {
    const key = columnNameToOptionKey(columnName);
    options[key] = [];
    return options;
  }, {});
}

function columnNameToOptionKey(columnName) {
  if (columnName === 'crm_brand_name') return 'crmBrandName';
  if (columnName === 'bonus_status') return 'bonusStatus';
  return 'bonusType';
}

function addFilterOption(key, value) {
  if (!value) return;
  storedFilterOptions[key].push(value);
}

function sortFilterOptions(options) {
  return Object.entries(options).reduce((sorted, [key, values]) => {
    sorted[key] = Array.from(new Set(values)).sort((a, b) => a.localeCompare(b, 'pt-BR'));
    return sorted;
  }, {});
}

function incrementMap(map, key, amount) {
  map.set(key, (map.get(key) || 0) + amount);
}

function incrementFinancialCostGroup(map, row) {
  const key = JSON.stringify([row.campaignName, row.templateName]);
  const current = map.get(key) || {
    campaignName: row.campaignName,
    templateName: row.templateName,
    sentCount: 0,
    sentAmount: 0,
    financialCostTotal: 0,
  };

  current.sentCount += 1;
  current.sentAmount += row.amount;
  current.financialCostTotal += row.cost * row.amount;
  map.set(key, current);
}

function mapToTopRows(map) {
  return Array.from(map.entries())
    .map(([name, value]) => ({ name, value: roundNumber(value) }))
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name, 'pt-BR'))
    .slice(0, 20);
}

function financialCostGroupsToTopRows(map) {
  return Array.from(map.values())
    .map((group) => {
      const financialCostTotal = roundNumber(group.financialCostTotal);

      return {
        campaignName: group.campaignName,
        templateName: group.templateName,
        sentCount: group.sentCount,
        sentAmount: roundNumber(group.sentAmount),
        financialCostTotal,
        averageFinancialCostPerSend: roundNumber(
          group.sentCount > 0 ? group.financialCostTotal / group.sentCount : 0,
        ),
        name: `${group.campaignName} / ${group.templateName}`,
        value: financialCostTotal,
      };
    })
    .sort(
      (a, b) =>
        b.financialCostTotal - a.financialCostTotal ||
        a.campaignName.localeCompare(b.campaignName, 'pt-BR') ||
        a.templateName.localeCompare(b.templateName, 'pt-BR'),
    )
    .slice(0, 20);
}

function roundNumber(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function yieldToBrowser() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
