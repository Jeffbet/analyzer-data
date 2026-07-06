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

const COLLAPSED_TOP_LIMIT = 5;

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
                <td>{formatValue(row.value, section.valueType)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function SectionToggle({ isExpanded, totalRows, onToggle }) {
  if (totalRows <= COLLAPSED_TOP_LIMIT) return null;

  return (
    <button type="button" className="section-toggle-button" onClick={onToggle}>
      {isExpanded ? 'Mostrar Top 5' : `Mostrar Top ${totalRows}`}
    </button>
  );
}

function getVisibleRows(rows, isExpanded) {
  return isExpanded ? rows : rows.slice(0, COLLAPSED_TOP_LIMIT);
}

function getSectionCountLabel(totalRows, visibleRows) {
  if (totalRows === 0) return '0 registros';
  return `Top ${visibleRows.length} de ${totalRows}`;
}

function AnalysisSection({ section, rows, isExpanded, onToggle }) {
  const visibleRows = getVisibleRows(rows, isExpanded);

  return (
    <section className="analysis-section">
      <div className="section-title">
        <h2>{section.title}</h2>
        <div className="section-actions">
          <span>{getSectionCountLabel(rows.length, visibleRows)}</span>
          <SectionToggle isExpanded={isExpanded} totalRows={rows.length} onToggle={onToggle} />
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

function FinancialCostSection({ rows, isExpanded, onToggle }) {
  const visibleRows = getVisibleRows(rows, isExpanded);

  return (
    <section className="analysis-section analysis-section--financial">
      <div className="section-title">
        <h2>{financialCostSection.title}</h2>
        <div className="section-actions">
          <span>{getSectionCountLabel(rows.length, visibleRows)}</span>
          <SectionToggle isExpanded={isExpanded} totalRows={rows.length} onToggle={onToggle} />
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
  const [expandedSections, setExpandedSections] = useState({});
  const [theme, setTheme] = useState(getInitialTheme);
  const workerRef = useRef(null);
  const fileInputRef = useRef(null);

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
    setExpandedSections({});
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
    setExpandedSections({});
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

          <div className="analysis-grid">
            <FinancialCostSection
              rows={state.results[financialCostSection.key] || []}
              isExpanded={Boolean(expandedSections[financialCostSection.key])}
              onToggle={() => toggleSection(financialCostSection.key)}
            />

            {resultSections.map((section) => (
              <AnalysisSection
                key={section.key}
                section={section}
                rows={state.results[section.key] || []}
                isExpanded={Boolean(expandedSections[section.key])}
                onToggle={() => toggleSection(section.key)}
              />
            ))}
          </div>
        </>
      )}
    </main>
  );
}
