import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

const INITIAL_STATE = {
  status: 'idle',
  fileName: '',
  error: '',
  progress: null,
  results: null,
  isFiltering: false,
};

const INITIAL_FILTERS = {
  search: '',
  crmBrandName: '',
  bonusStatus: '',
  bonusType: '',
};

const DEFAULT_RANKING_LIMIT = 20;
const COLLAPSED_TOP_LIMIT = 5;
const RANKING_LIMIT_OPTIONS = [10, 20, 50];

const filterLabels = {
  search: 'Busca',
  crmBrandName: 'Marca CRM',
  bonusStatus: 'Status',
  bonusType: 'Tipo de bonus',
};

const summaryCards = [
  { key: 'totalRows', label: 'Total de linhas', type: 'integer', tone: 'navy' },
  { key: 'uniqueTemplates', label: 'Templates unicos', type: 'integer', tone: 'green' },
  { key: 'uniqueCampaigns', label: 'Campanhas unicas', type: 'integer', tone: 'orange' },
  { key: 'totalCost', label: 'Custo total', type: 'decimal', tone: 'light' },
  {
    key: 'totalSpinsWithoutCashback',
    label: 'Total de giros sem cashback',
    type: 'decimal',
    tone: 'navy',
  },
  { key: 'totalCashback', label: 'Total de cashback', type: 'decimal', tone: 'green' },
  { key: 'cashbackRows', label: 'Linhas de cashback', type: 'integer', tone: 'orange' },
];

const resultSections = [
  {
    key: 'topCampaignsByCount',
    title: 'Campanhas por quantidade de envios',
    nameLabel: 'Campanha',
    valueLabel: 'Envios',
    valueType: 'integer',
    color: '#156f6d',
  },
  {
    key: 'topCampaignsByAmount',
    title: 'Campanhas por soma de bonus_amount',
    nameLabel: 'Campanha',
    valueLabel: 'Bonus amount',
    valueType: 'decimal',
    color: '#e85d3f',
  },
  {
    key: 'topTemplatesByCount',
    title: 'Templates por quantidade de envios',
    nameLabel: 'Template',
    valueLabel: 'Envios',
    valueType: 'integer',
    color: '#243b6b',
  },
  {
    key: 'topTemplatesByAmount',
    title: 'Templates por soma de bonus_amount',
    nameLabel: 'Template',
    valueLabel: 'Bonus amount',
    valueType: 'decimal',
    color: '#8a5a00',
  },
  {
    key: 'topCashbackByValue',
    title: 'Top cashback por valor',
    nameLabel: 'Template cashback',
    valueLabel: 'Valor',
    valueType: 'decimal',
    color: '#5a3d8c',
  },
];

const financialCostSection = {
  key: 'topFinancialCostByCampaignTemplate',
  title: 'Campanhas e jogos por custo financeiro',
  nameLabel: 'Campanha / Template',
  valueLabel: 'Custo financeiro total',
  valueType: 'decimal',
  color: '#0f766e',
  labelMaxLength: 30,
  yAxisWidth: 260,
};

function getInitialTheme() {
  if (typeof window === 'undefined') return 'light';

  const storedTheme = window.localStorage.getItem('analyzer-theme');
  if (storedTheme === 'dark' || storedTheme === 'light') return storedTheme;

  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function formatNumber(value) {
  return new Intl.NumberFormat('pt-BR').format(value || 0);
}

function formatDecimal(value) {
  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value || 0);
}

function formatValue(value, type) {
  return type === 'decimal' ? formatDecimal(value) : formatNumber(value);
}

function formatFileSize(bytes) {
  if (!bytes) return '0 KB';
  const units = ['bytes', 'KB', 'MB', 'GB'];
  const power = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const amount = bytes / 1024 ** power;
  return `${amount.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} ${units[power]}`;
}

function escapeMarkdownCell(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ');
}

function buildMarkdownTable(headers, rows) {
  const headerLine = `| ${headers.map(escapeMarkdownCell).join(' | ')} |`;
  const separatorLine = `| ${headers.map(() => '---').join(' | ')} |`;
  const bodyLines =
    rows.length === 0
      ? [`| ${headers.map((_, index) => (index === 0 ? 'Nenhum registro encontrado.' : '')).join(' | ')} |`]
      : rows.map((row) => `| ${row.map(escapeMarkdownCell).join(' | ')} |`);

  return [headerLine, separatorLine, ...bodyLines].join('\n');
}

function escapeCsvCell(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function buildCsv(headers, rows) {
  return [headers, ...rows].map((row) => row.map(escapeCsvCell).join(',')).join('\r\n');
}

function getSimpleTableData(section, rows) {
  return {
    headers: ['#', section.nameLabel, section.valueLabel],
    rows: rows.map((row, index) => [
      index + 1,
      row.name,
      formatValue(row.value, section.valueType),
    ]),
  };
}

function getFinancialTableData(rows) {
  return {
    headers: [
      'Campanha',
      'Jogo / Template',
      'Qtd envios',
      'Qtd enviada',
      'Custo financeiro total',
      'Custo medio por envio',
    ],
    rows: rows.map((row) => [
      row.campaignName,
      row.templateName,
      formatNumber(row.sentCount),
      formatDecimal(row.sentAmount),
      formatDecimal(row.financialCostTotal),
      formatDecimal(row.averageFinancialCostPerSend),
    ]),
  };
}

function makeDownloadName(baseName, extension) {
  return `${baseName}-${new Date().toISOString().slice(0, 10)}.${extension}`;
}

function getActiveFilterLabel(filters) {
  const activeFilters = getActiveFilters(filters);
  if (activeFilters.length === 0) return 'Nenhum filtro ativo';

  return activeFilters.map(([key, value]) => `${filterLabels[key]}: ${value}`).join('; ');
}

function getTopLabel(row, valueLabel, valueType) {
  if (!row) return 'Sem dados no recorte atual.';
  return `${row.name} (${valueLabel}: ${formatValue(row.value, valueType)})`;
}

function getFinancialTopLabel(row) {
  if (!row) return 'Sem dados no recorte atual.';

  return `${row.campaignName} / ${row.templateName} (custo financeiro total: ${formatDecimal(
    row.financialCostTotal,
  )})`;
}

function buildReportMarkdown({ results, rankingLimit, filters }) {
  const financialRows = (results[financialCostSection.key] || []).slice(0, rankingLimit);
  const summaryRows = summaryCards.map((card) => [
    card.label,
    formatValue(results.summary[card.key], card.type),
  ]);

  const rankingSections = resultSections.map((section) => {
    const tableData = getSimpleTableData(section, (results[section.key] || []).slice(0, rankingLimit));
    return [`### ${section.title}`, buildMarkdownTable(tableData.headers, tableData.rows)].join('\n\n');
  });
  const financialTableData = getFinancialTableData(financialRows);

  return [
    '# Relatorio do analisador de bonus',
    '',
    `Recorte: ${getActiveFilterLabel(filters)}`,
    `Ranking: Top ${rankingLimit}`,
    '',
    '## Resumo geral',
    '',
    buildMarkdownTable(['Metrica', 'Valor'], summaryRows),
    '',
    '## Destaques automaticos',
    '',
    `- Maior campanha por envios: ${getTopLabel(
      results.topCampaignsByCount?.[0],
      'envios',
      'integer',
    )}`,
    `- Maior campanha por bonus_amount: ${getTopLabel(
      results.topCampaignsByAmount?.[0],
      'bonus_amount',
      'decimal',
    )}`,
    `- Maior template por envios: ${getTopLabel(
      results.topTemplatesByCount?.[0],
      'envios',
      'integer',
    )}`,
    `- Maior template por bonus_amount: ${getTopLabel(
      results.topTemplatesByAmount?.[0],
      'bonus_amount',
      'decimal',
    )}`,
    `- Maior cashback por valor: ${getTopLabel(results.topCashbackByValue?.[0], 'valor', 'decimal')}`,
    `- Maior campanha+jogo por custo financeiro: ${getFinancialTopLabel(
      results.topFinancialCostByCampaignTemplate?.[0],
    )}`,
    '',
    '## Principais rankings',
    '',
    ...rankingSections.flatMap((sectionMarkdown) => [sectionMarkdown, '']),
    '## Campanhas e jogos por custo financeiro',
    '',
    'Comparativo entre campanha e jogo/template por custo financeiro.',
    '',
    buildMarkdownTable(financialTableData.headers, financialTableData.rows),
    '',
  ].join('\n');
}

function buildCampaignReportMarkdown({ report, filters, headingLevel = 1 }) {
  const summaryRows = [
    ['Campanha', report.campaignName],
    ['Envios', formatNumber(report.sentCount)],
    ['Quantidade enviada', formatDecimal(report.sentAmount)],
    ['Custo financeiro total', formatDecimal(report.financialCostTotal)],
    ['Custo medio por envio', formatDecimal(report.averageFinancialCostPerSend)],
    ['Templates unicos', formatNumber(report.uniqueTemplates)],
    ['Linhas de cashback', formatNumber(report.cashbackRows)],
    ['Total de cashback', formatDecimal(report.cashbackAmount)],
  ];
  const templatesByCount = getSimpleTableData(
    {
      key: 'campaignTemplatesByCount',
      nameLabel: 'Template',
      valueLabel: 'Envios',
      valueType: 'integer',
    },
    report.topTemplatesByCount || [],
  );
  const templatesByAmount = getSimpleTableData(
    {
      key: 'campaignTemplatesByAmount',
      nameLabel: 'Template',
      valueLabel: 'Bonus amount',
      valueType: 'decimal',
    },
    report.topTemplatesByAmount || [],
  );
  const financialRows = getFinancialTableData(report.topFinancialCostByTemplate || []);

  return [
    `${'#'.repeat(headingLevel)} Relatorio da campanha: ${report.campaignName}`,
    '',
    `Recorte: ${getActiveFilterLabel(filters)}`,
    '',
    '## Resumo da campanha',
    '',
    buildMarkdownTable(['Metrica', 'Valor'], summaryRows),
    '',
    '## Templates por envios',
    '',
    buildMarkdownTable(templatesByCount.headers, templatesByCount.rows),
    '',
    '## Templates por bonus_amount',
    '',
    buildMarkdownTable(templatesByAmount.headers, templatesByAmount.rows),
    '',
    '## Campanha e jogos por custo financeiro',
    '',
    buildMarkdownTable(financialRows.headers, financialRows.rows),
    '',
  ].join('\n');
}

function buildCampaignReportsMarkdown({ reports, sectionTitle, filters }) {
  if (reports.length === 0) {
    return [
      `# Relatorios de campanhas: ${sectionTitle}`,
      '',
      `Recorte: ${getActiveFilterLabel(filters)}`,
      '',
      'Nenhuma campanha encontrada no recorte atual.',
      '',
    ].join('\n');
  }

  return [
    `# Relatorios de campanhas: ${sectionTitle}`,
    '',
    `Recorte: ${getActiveFilterLabel(filters)}`,
    '',
    ...reports.flatMap((report) => [buildCampaignReportMarkdown({ report, filters, headingLevel: 2 }), '']),
  ].join('\n');
}

function SummaryCard({ card, value }) {
  return (
    <article className={`summary-card summary-card--${card.tone}`}>
      <span>{card.label}</span>
      <strong>{formatValue(value, card.type)}</strong>
    </article>
  );
}

function getActiveFilters(filters) {
  return Object.entries(filters).filter(([, value]) => String(value || '').trim() !== '');
}

function FilterSelect({ id, label, value, options, onChange }) {
  if (!options?.length) return null;

  return (
    <label className="filter-control" htmlFor={id}>
      <span>{label}</span>
      <select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Todos</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function FilterPanel({ filters, filterOptions, isFiltering, onChange, onClear }) {
  const activeFilters = getActiveFilters(filters);

  return (
    <section className="filter-panel">
      <div className="filter-header">
        <div>
          <h2>Filtros da analise</h2>
          <p>Os cards, graficos e tabelas sao recalculados localmente no navegador.</p>
        </div>
        {activeFilters.length > 0 && (
          <button type="button" className="clear-filters-button" onClick={onClear}>
            Limpar filtros
          </button>
        )}
      </div>

      <div className="filter-grid">
        <label className="filter-control filter-control--wide" htmlFor="search-filter">
          <span>Busca textual</span>
          <input
            id="search-filter"
            type="search"
            value={filters.search}
            placeholder="Campanha, template, tipo ou template externo"
            onChange={(event) => onChange('search', event.target.value)}
          />
        </label>

        <FilterSelect
          id="brand-filter"
          label="Marca CRM"
          value={filters.crmBrandName}
          options={filterOptions.crmBrandName}
          onChange={(value) => onChange('crmBrandName', value)}
        />
        <FilterSelect
          id="status-filter"
          label="Status"
          value={filters.bonusStatus}
          options={filterOptions.bonusStatus}
          onChange={(value) => onChange('bonusStatus', value)}
        />
        <FilterSelect
          id="type-filter"
          label="Tipo de bonus"
          value={filters.bonusType}
          options={filterOptions.bonusType}
          onChange={(value) => onChange('bonusType', value)}
        />
      </div>

      <div className="active-filter-row">
        {activeFilters.length === 0 ? (
          <span className="no-filters">Nenhum filtro ativo.</span>
        ) : (
          activeFilters.map(([key, value]) => (
            <span className="filter-chip" key={key}>
              {filterLabels[key]}: {value}
            </span>
          ))
        )}
        {isFiltering && <span className="filter-status">Recalculando...</span>}
      </div>
    </section>
  );
}

function EmptyState() {
  return (
    <section className="empty-state">
      <h2>Nenhum CSV carregado</h2>
      <p>Importe um arquivo para gerar os cards, filtros, graficos e tabelas.</p>
    </section>
  );
}

function NoResultsState({ onClear }) {
  return (
    <section className="no-results-state">
      <div>
        <h2>Nenhum resultado encontrado</h2>
        <p>O recorte atual nao retornou linhas. Limpe os filtros ou ajuste a busca.</p>
      </div>
      <button type="button" className="clear-filters-button" onClick={onClear}>
        Limpar filtros
      </button>
    </section>
  );
}

function truncateLabel(value, maxLength = 42) {
  const text = String(value || '');
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}...`;
}

function ChartTooltip({ active, payload, label, section }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;

  return (
    <div className="chart-tooltip">
      <strong>{row.name || label}</strong>
      <span>
        {section.valueLabel}: {formatValue(row.value, section.valueType)}
      </span>
    </div>
  );
}

function TopChart({ section, rows }) {
  const chartData = rows.map((row) => ({
    ...row,
    chartLabel: truncateLabel(row.name, section.labelMaxLength),
  }));
  const chartHeight = section.chartHeight || Math.max(260, rows.length * 30 + 90);
  const yAxisWidth = section.yAxisWidth || 220;

  return (
    <div className="chart-box" aria-label={section.title}>
      {rows.length === 0 ? (
        <p className="empty-chart">Nenhum registro para gerar o grafico.</p>
      ) : (
        <ResponsiveContainer width="100%" height={chartHeight}>
          <BarChart
            data={chartData}
            layout="vertical"
            margin={{ top: 8, right: 20, bottom: 8, left: 8 }}
          >
            <CartesianGrid stroke="var(--chart-grid)" horizontal={false} />
            <XAxis
              type="number"
              tickFormatter={(value) => formatValue(value, section.valueType)}
              tick={{ fill: 'var(--muted)', fontSize: 12 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              type="category"
              dataKey="chartLabel"
              width={yAxisWidth}
              tick={{ fill: 'var(--text)', fontSize: 12 }}
              axisLine={false}
              tickLine={false}
              interval={0}
            />
            <Tooltip content={<ChartTooltip section={section} />} cursor={{ fill: 'var(--chart-cursor)' }} />
            <Bar dataKey="value" fill={section.color} radius={[0, 6, 6, 0]} barSize={14} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

function isCampaignSection(section) {
  return section.key === 'topCampaignsByCount' || section.key === 'topCampaignsByAmount';
}

function ResultsTable({ section, rows }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>{section.nameLabel}</th>
            <th>{section.valueLabel}</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan="3" className="empty-cell">
                Nenhum registro encontrado.
              </td>
            </tr>
          ) : (
            rows.map((row, index) => (
              <tr key={`${section.key}-${row.name}-${index}`}>
                <td>{index + 1}</td>
                <td title={row.name}>{row.name}</td>
                <td className="number-cell">{formatValue(row.value, section.valueType)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function getVisibleRows(rows, rankingLimit, isExpanded) {
  return rows.slice(0, isExpanded ? rankingLimit : COLLAPSED_TOP_LIMIT);
}

function getSectionCountLabel(rows, visibleRows, rankingLimit) {
  if (visibleRows.length === 0) return '0 registros';
  const availableRows = Math.min(rows.length, rankingLimit);
  return `Top ${visibleRows.length} de ${availableRows}`;
}

function SectionToggle({ isExpanded, totalRows, rankingLimit, onToggle }) {
  if (totalRows <= COLLAPSED_TOP_LIMIT) return null;

  return (
    <button type="button" className="compact-button" onClick={onToggle}>
      {isExpanded ? 'Mostrar Top 5' : `Mostrar mais`}
    </button>
  );
}

function TableActions({ copied, campaignReportCopied, showCampaignReport, onCopy, onExport, onCopyCampaignReports }) {
  return (
    <>
      {copied && <span className="copy-feedback">Copiado</span>}
      <button type="button" className="compact-button" onClick={onCopy}>
        Copiar tabela
      </button>
      {showCampaignReport && (
        <>
          {campaignReportCopied && <span className="copy-feedback">Copiado</span>}
          <button type="button" className="compact-button" onClick={onCopyCampaignReports}>
            Copiar relatorio
          </button>
        </>
      )}
      <button type="button" className="compact-button" onClick={onExport}>
        Exportar CSV
      </button>
    </>
  );
}

function ReportPanel({
  copied,
  rankingLimit,
  onCopyReport,
  onDownloadReport,
  onRankingLimitChange,
}) {
  return (
    <section className="report-panel">
      <div>
        <h2>Relatorio geral</h2>
        <p>Gera um resumo copiavel com destaques, rankings e comparativo financeiro.</p>
      </div>

      <div className="report-actions">
        <label className="ranking-control" htmlFor="ranking-limit">
          <span>Ranking</span>
          <select
            id="ranking-limit"
            value={rankingLimit}
            onChange={(event) => onRankingLimitChange(Number(event.target.value))}
          >
            {RANKING_LIMIT_OPTIONS.map((option) => (
              <option key={option} value={option}>
                Top {option}
              </option>
            ))}
          </select>
        </label>
        <div className="report-button-row">
          {copied && <span className="copy-feedback">Copiado</span>}
          <button type="button" className="compact-button" onClick={onCopyReport}>
            Copiar relatorio
          </button>
          <button type="button" className="compact-button" onClick={() => onDownloadReport('md')}>
            Baixar .md
          </button>
          <button type="button" className="compact-button" onClick={() => onDownloadReport('txt')}>
            Baixar .txt
          </button>
        </div>
      </div>
    </section>
  );
}

function AnalysisSection({
  section,
  rows,
  rankingLimit,
  isExpanded,
  copiedAction,
  onCopyTable,
  onExportCsv,
  onToggle,
  onCopyCampaignReports,
}) {
  const visibleRows = getVisibleRows(rows, rankingLimit, isExpanded);
  const showCampaignReport = isCampaignSection(section);

  return (
    <section className="analysis-section">
      <div className="section-title">
        <h2>{section.title}</h2>
        <div className="section-actions">
          <span>{getSectionCountLabel(rows, visibleRows, rankingLimit)}</span>
          <SectionToggle
            isExpanded={isExpanded}
            totalRows={Math.min(rows.length, rankingLimit)}
            rankingLimit={rankingLimit}
            onToggle={onToggle}
          />
          <TableActions
            copied={copiedAction === `table-${section.key}`}
            campaignReportCopied={copiedAction === `campaign-table-${section.key}`}
            showCampaignReport={showCampaignReport}
            onCopy={() => onCopyTable(section, visibleRows)}
            onExport={() => onExportCsv(section, visibleRows)}
            onCopyCampaignReports={() => onCopyCampaignReports(section, visibleRows)}
          />
        </div>
      </div>

      <div className="analysis-content">
        <TopChart section={section} rows={visibleRows} />
        <ResultsTable section={section} rows={visibleRows} />
      </div>
    </section>
  );
}

function FinancialCostTable({ rows }) {
  return (
    <div className="table-wrap table-wrap--wide">
      <table className="financial-cost-table">
        <thead>
          <tr>
            <th>Campanha</th>
            <th>Jogo / Template</th>
            <th>Qtd envios</th>
            <th>Qtd enviada</th>
            <th>Custo financeiro total</th>
            <th>Custo medio por envio</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan="6" className="empty-cell">
                Nenhum registro encontrado.
              </td>
            </tr>
          ) : (
            rows.map((row, index) => (
              <tr key={`${row.campaignName}-${row.templateName}-${index}`}>
                <td title={row.campaignName}>{row.campaignName}</td>
                <td title={row.templateName}>{row.templateName}</td>
                <td>{formatNumber(row.sentCount)}</td>
                <td>{formatDecimal(row.sentAmount)}</td>
                <td>{formatDecimal(row.financialCostTotal)}</td>
                <td>{formatDecimal(row.averageFinancialCostPerSend)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function FinancialCostSection({
  rows,
  rankingLimit,
  isExpanded,
  copiedAction,
  onCopyTable,
  onExportCsv,
  onToggle,
}) {
  const visibleRows = getVisibleRows(rows, rankingLimit, isExpanded);

  return (
    <section className="analysis-section analysis-section--financial">
      <div className="section-title">
        <h2>{financialCostSection.title}</h2>
        <div className="section-actions">
          <span>{getSectionCountLabel(rows, visibleRows, rankingLimit)}</span>
          <SectionToggle
            isExpanded={isExpanded}
            totalRows={Math.min(rows.length, rankingLimit)}
            rankingLimit={rankingLimit}
            onToggle={onToggle}
          />
          <TableActions
            copied={copiedAction === `table-${financialCostSection.key}`}
            onCopy={() => onCopyTable(financialCostSection, visibleRows)}
            onExport={() => onExportCsv(financialCostSection, visibleRows)}
          />
        </div>
      </div>

      <div className="analysis-content analysis-content--financial">
        <TopChart section={financialCostSection} rows={visibleRows} />
        <FinancialCostTable rows={visibleRows} />
      </div>
    </section>
  );
}

export default function App() {
  const [state, setState] = useState(INITIAL_STATE);
  const [filters, setFilters] = useState(INITIAL_FILTERS);
  const [rankingLimit, setRankingLimit] = useState(DEFAULT_RANKING_LIMIT);
  const [expandedSections, setExpandedSections] = useState({});
  const [copiedAction, setCopiedAction] = useState('');
  const [theme, setTheme] = useState(getInitialTheme);
  const workerRef = useRef(null);
  const fileInputRef = useRef(null);
  const copyFeedbackTimeoutRef = useRef(null);

  const isProcessing = state.status === 'processing';
  const activeFilters = getActiveFilters(filters);
  const hasNoFilteredResults =
    state.results && activeFilters.length > 0 && state.results.summary.totalRows === 0;
  const progressPercent = useMemo(() => {
    if (!state.progress?.totalBytes) return 0;
    return Math.min(100, Math.round((state.progress.loadedBytes / state.progress.totalBytes) * 100));
  }, [state.progress]);

  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      window.clearTimeout(copyFeedbackTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem('analyzer-theme', theme);
  }, [theme]);

  useEffect(() => {
    if (state.status !== 'done' || !workerRef.current) return undefined;

    const timeout = window.setTimeout(() => {
      setState((current) => ({
        ...current,
        isFiltering: true,
      }));
      workerRef.current?.postMessage({ type: 'filter', filters });
    }, 250);

    return () => window.clearTimeout(timeout);
  }, [filters, state.fileName, state.status]);

  function processFile(file) {
    if (!file) return;

    workerRef.current?.terminate();
    setFilters(INITIAL_FILTERS);
    setRankingLimit(DEFAULT_RANKING_LIMIT);
    setExpandedSections({});
    setCopiedAction('');
    const worker = new Worker(new URL('./workers/csvAnalyzer.worker.js', import.meta.url), {
      type: 'module',
    });

    workerRef.current = worker;
    setState({
      status: 'processing',
      fileName: file.name,
      error: '',
      progress: {
        loadedBytes: 0,
        totalBytes: file.size,
        rows: 0,
      },
      results: null,
      isFiltering: false,
    });

    worker.onmessage = (event) => {
      const { type, payload } = event.data;

      if (type === 'progress') {
        setState((current) => ({
          ...current,
          progress: payload,
        }));
        return;
      }

      if (type === 'done') {
        setState((current) => ({
          ...current,
          status: 'done',
          progress: payload.progress,
          results: payload.results,
          isFiltering: false,
        }));
        return;
      }

      if (type === 'filtered') {
        setState((current) => ({
          ...current,
          status: 'done',
          results: payload.results,
          isFiltering: false,
        }));
        return;
      }

      if (type === 'error') {
        setState((current) => ({
          ...current,
          status: 'error',
          error: payload.message,
          progress: null,
          isFiltering: false,
        }));
        worker.terminate();
        workerRef.current = null;
      }
    };

    worker.onerror = (error) => {
      setState((current) => ({
        ...current,
        status: 'error',
        error: error.message || 'Erro inesperado ao processar o arquivo.',
        isFiltering: false,
      }));
      worker.terminate();
      workerRef.current = null;
    };

    worker.postMessage({ file });
  }

  function handleFileChange(event) {
    processFile(event.target.files?.[0]);
  }

  function handleDrop(event) {
    event.preventDefault();
    processFile(event.dataTransfer.files?.[0]);
  }

  function handleDragOver(event) {
    event.preventDefault();
  }

  function resetFile() {
    workerRef.current?.terminate();
    workerRef.current = null;
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    setFilters(INITIAL_FILTERS);
    setRankingLimit(DEFAULT_RANKING_LIMIT);
    setExpandedSections({});
    setCopiedAction('');
    setState(INITIAL_STATE);
  }

  function updateFilter(key, value) {
    setFilters((current) => ({
      ...current,
      [key]: value,
    }));
  }

  function clearFilters() {
    setFilters(INITIAL_FILTERS);
  }

  function toggleTheme() {
    setTheme((current) => (current === 'dark' ? 'light' : 'dark'));
  }

  function toggleSection(sectionKey) {
    setExpandedSections((current) => ({
      ...current,
      [sectionKey]: !current[sectionKey],
    }));
  }

  function showCopiedFeedback(actionKey) {
    window.clearTimeout(copyFeedbackTimeoutRef.current);
    setCopiedAction(actionKey);
    copyFeedbackTimeoutRef.current = window.setTimeout(() => {
      setCopiedAction('');
    }, 1800);
  }

  function copyWithFallback(text) {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.setAttribute('readonly', '');
    textArea.style.position = 'fixed';
    textArea.style.left = '-9999px';
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand('copy');
    document.body.removeChild(textArea);
  }

  async function copyText(text, actionKey) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        copyWithFallback(text);
      }
    } catch {
      copyWithFallback(text);
    }

    showCopiedFeedback(actionKey);
  }

  function downloadText(content, fileName, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function getReportMarkdown() {
    return buildReportMarkdown({
      results: state.results,
      rankingLimit,
      filters,
    });
  }

  function copyReport() {
    copyText(getReportMarkdown(), 'report');
  }

  function downloadReport(extension) {
    const content = getReportMarkdown();
    downloadText(
      content,
      makeDownloadName('relatorio-analisador-bonus', extension),
      extension === 'md' ? 'text/markdown;charset=utf-8' : 'text/plain;charset=utf-8',
    );
  }

  function getTableData(section, rows) {
    return section.key === financialCostSection.key
      ? getFinancialTableData(rows)
      : getSimpleTableData(section, rows);
  }

  function copyTable(section, rows) {
    const tableData = getTableData(section, rows);
    copyText(buildMarkdownTable(tableData.headers, tableData.rows), `table-${section.key}`);
  }

  function copyCampaignReports(section, rows) {
    const reports = rows
      .map((row) => state.results?.campaignReports?.[row.name])
      .filter(Boolean);

    copyText(
      buildCampaignReportsMarkdown({
        reports,
        sectionTitle: section.title,
        filters,
      }),
      `campaign-table-${section.key}`,
    );
  }

  function exportCsv(section, rows) {
    const tableData = getTableData(section, rows);
    downloadText(
      buildCsv(tableData.headers, tableData.rows),
      makeDownloadName(section.key, 'csv'),
      'text/csv;charset=utf-8',
    );
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">MVP web local</p>
          <h1>Analisador de Bonus</h1>
        </div>
        <div className="header-actions">
          <button type="button" className="secondary-button" onClick={toggleTheme}>
            {theme === 'dark' ? 'Tema claro' : 'Tema escuro'}
          </button>
          <button type="button" className="secondary-button" onClick={resetFile} disabled={isProcessing}>
            Limpar
          </button>
        </div>
      </header>

      <section className="upload-panel" onDrop={handleDrop} onDragOver={handleDragOver}>
        <div>
          <h2>Importar CSV</h2>
          <p>
            O processamento roda 100% no navegador. Selecione um arquivo com as colunas
            bonus_amount, bonus_cost_value, bonus_template_name, source_entity_name, bonus_type e
            ext_template_name.
          </p>
        </div>

        <label className="file-button">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={handleFileChange}
            disabled={isProcessing}
          />
          Escolher CSV
        </label>
      </section>

      {state.fileName && (
        <section className="status-panel" aria-live="polite">
          <div>
            <strong>{state.fileName}</strong>
            <span>{state.progress?.totalBytes ? formatFileSize(state.progress.totalBytes) : ''}</span>
          </div>

          {isProcessing && (
            <div className="progress-area">
              <div className="progress-label">
                <span>Processando arquivo</span>
                <span>
                  {progressPercent}% - {formatNumber(state.progress?.rows || 0)} linhas
                </span>
              </div>
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${progressPercent}%` }} />
              </div>
            </div>
          )}

          {state.status === 'done' && (
            <p className="success-message">
              Arquivo processado com sucesso: {formatNumber(state.results.summary.totalRows)} linhas.
            </p>
          )}

          {state.status === 'error' && <p className="error-message">{state.error}</p>}

          {state.results?.warnings?.length > 0 && (
            <ul className="warning-list">
              {state.results.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          )}
        </section>
      )}

      {!state.fileName && <EmptyState />}

      {state.results && (
        <>
          <FilterPanel
            filters={filters}
            filterOptions={state.results.filterOptions || INITIAL_FILTERS}
            isFiltering={state.isFiltering}
            onChange={updateFilter}
            onClear={clearFilters}
          />

          {hasNoFilteredResults && <NoResultsState onClear={clearFilters} />}

          <section className="summary-grid">
            {summaryCards.map((card) => (
              <SummaryCard key={card.key} card={card} value={state.results.summary[card.key]} />
            ))}
          </section>

          <ReportPanel
            copied={copiedAction === 'report'}
            rankingLimit={rankingLimit}
            onCopyReport={copyReport}
            onDownloadReport={downloadReport}
            onRankingLimitChange={setRankingLimit}
          />

          <div className="analysis-grid">
            <FinancialCostSection
              rows={state.results[financialCostSection.key] || []}
              rankingLimit={rankingLimit}
              isExpanded={Boolean(expandedSections[financialCostSection.key])}
              copiedAction={copiedAction}
              onCopyTable={copyTable}
              onExportCsv={exportCsv}
              onToggle={() => toggleSection(financialCostSection.key)}
            />

            {resultSections.map((section) => (
              <AnalysisSection
                key={section.key}
                section={section}
                rows={state.results[section.key] || []}
                rankingLimit={rankingLimit}
                isExpanded={Boolean(expandedSections[section.key])}
                copiedAction={copiedAction}
                onCopyTable={copyTable}
                onExportCsv={exportCsv}
                onToggle={() => toggleSection(section.key)}
                onCopyCampaignReports={copyCampaignReports}
              />
            ))}
          </div>
        </>
      )}
    </main>
  );
}
