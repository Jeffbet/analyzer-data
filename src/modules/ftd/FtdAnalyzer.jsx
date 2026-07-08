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
import './ftdAnalyzer.css';

const TOP_OPTIONS = [10, 20, 50];
const INITIAL_PROCESS_STATE = {
  status: 'idle',
  progress: null,
  error: '',
  results: null,
};

const VIEWS = {
  campaign: {
    label: 'Impacto por campanha',
    nameKey: 'campaign',
    nameLabel: 'Campanha',
  },
  template: {
    label: 'Impacto por template',
    nameKey: 'template',
    nameLabel: 'Template',
  },
  id: {
    label: 'Resultado por ID',
  },
};

export default function FtdAnalyzer() {
  const [ftdFile, setFtdFile] = useState(null);
  const [crmFile, setCrmFile] = useState(null);
  const [processState, setProcessState] = useState(INITIAL_PROCESS_STATE);
  const [activeView, setActiveView] = useState('campaign');
  const [search, setSearch] = useState('');
  const [topLimit, setTopLimit] = useState(20);
  const [feedback, setFeedback] = useState('');
  const workerRef = useRef(null);
  const feedbackTimeoutRef = useRef(null);

  useEffect(
    () => () => {
      workerRef.current?.terminate();
      window.clearTimeout(feedbackTimeoutRef.current);
    },
    [],
  );

  const results = processState.results;
  const allViewRows = useMemo(() => getViewRows(results, activeView), [results, activeView]);
  const filteredRows = useMemo(
    () => filterViewRows(allViewRows, activeView, search),
    [allViewRows, activeView, search],
  );
  const visibleRows = filteredRows.slice(0, topLimit);
  const isProcessing = processState.status === 'processing';
  const canProcess = Boolean(ftdFile && crmFile && !isProcessing);

  function selectFile(kind, file) {
    setFeedback('');
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.csv')) {
      setProcessState({
        status: 'error',
        progress: null,
        error: 'Formato nao suportado. Selecione um arquivo CSV.',
        results: null,
      });
      if (kind === 'ftd') setFtdFile(null);
      else setCrmFile(null);
      return;
    }

    if (kind === 'ftd') setFtdFile(file);
    else setCrmFile(file);
    setProcessState({
      status: 'idle',
      progress: null,
      error: '',
      results: null,
    });
  }

  function processFiles() {
    if (!canProcess) return;

    workerRef.current?.terminate();
    const worker = new Worker(new URL('../../workers/ftdAnalyzer.worker.js', import.meta.url), {
      type: 'module',
    });
    workerRef.current = worker;
    setSearch('');
    setActiveView('campaign');
    setFeedback('');
    setProcessState({
      status: 'processing',
      progress: {
        phase: 'Preparando arquivos',
        loadedBytes: 0,
        totalBytes: ftdFile.size + crmFile.size,
        rows: 0,
      },
      error: '',
      results: null,
    });

    worker.onmessage = (event) => {
      const { type, payload } = event.data;

      if (type === 'progress') {
        setProcessState((current) => ({ ...current, progress: payload }));
        return;
      }

      if (type === 'done') {
        setProcessState({
          status: 'done',
          progress: null,
          error: '',
          results: payload.results,
        });
        worker.terminate();
        if (workerRef.current === worker) workerRef.current = null;
        return;
      }

      if (type === 'error') {
        setProcessState({
          status: 'error',
          progress: null,
          error: payload.message,
          results: null,
        });
        worker.terminate();
        if (workerRef.current === worker) workerRef.current = null;
      }
    };

    worker.onerror = (error) => {
      setProcessState({
        status: 'error',
        progress: null,
        error: error.message || 'Erro inesperado no processamento local.',
        results: null,
      });
      worker.terminate();
      if (workerRef.current === worker) workerRef.current = null;
    };

    worker.postMessage({
      type: 'process',
      ftdFile,
      crmFile,
    });
  }

  async function copyCurrentTable() {
    const table = getTableData(activeView, filteredRows);
    await copyText(buildMarkdownTable(table.headers, table.rows));
    showFeedback('Copiado');
  }

  function exportCurrentCsv() {
    const table = getTableData(activeView, filteredRows, false);
    downloadText(
      buildCsv(table.headers, table.rows),
      `cruzamento-ftd-${activeView}.csv`,
      'text/csv;charset=utf-8',
    );
    showFeedback('CSV baixado');
  }

  function showFeedback(message) {
    window.clearTimeout(feedbackTimeoutRef.current);
    setFeedback(message);
    feedbackTimeoutRef.current = window.setTimeout(() => setFeedback(''), 1800);
  }

  return (
    <main className="ftd-module">
      <header className="ftd-header">
        <div>
          <p className="ftd-eyebrow">Analise local</p>
          <h1>Cruzamento FTD</h1>
        </div>
        <button
          type="button"
          className="ftd-primary-button"
          onClick={processFiles}
          disabled={!canProcess}
        >
          {isProcessing ? 'Processando...' : 'Processar cruzamento'}
        </button>
      </header>

      <section className="ftd-import-grid" aria-label="Importacao dos arquivos">
        <FileImport
          id="ftd-base-file"
          label="Base FTD / Metabase"
          file={ftdFile}
          disabled={isProcessing}
          onSelect={(file) => selectFile('ftd', file)}
        />
        <FileImport
          id="ftd-crm-file"
          label="Historico CRM"
          file={crmFile}
          disabled={isProcessing}
          onSelect={(file) => selectFile('crm', file)}
        />
      </section>

      {processState.status === 'processing' && <ProgressPanel progress={processState.progress} />}
      {processState.status === 'error' && (
        <section className="ftd-message ftd-message--error" role="alert">
          {processState.error}
        </section>
      )}

      {results && (
        <>
          {results.warnings.length > 0 && (
            <section className="ftd-warning-list" aria-label="Avisos das colunas">
              {results.warnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
            </section>
          )}

          <SummaryCards summary={results.summary} />

          <section className="ftd-results">
            <div className="ftd-view-tabs" role="tablist" aria-label="Visoes do cruzamento">
              {Object.entries(VIEWS).map(([key, view]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={activeView === key}
                  className={activeView === key ? 'is-active' : ''}
                  onClick={() => {
                    setActiveView(key);
                    setSearch('');
                  }}
                >
                  {view.label}
                </button>
              ))}
            </div>

            <div className="ftd-result-toolbar">
              <label className="ftd-search-field">
                <span>Buscar</span>
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="ID, campanha ou template"
                />
              </label>

              <label className="ftd-top-control">
                <span>Exibir</span>
                <select value={topLimit} onChange={(event) => setTopLimit(Number(event.target.value))}>
                  {TOP_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      Top {option}
                    </option>
                  ))}
                </select>
              </label>

              <div className="ftd-export-actions">
                {feedback && <span className="ftd-feedback">{feedback}</span>}
                <button
                  type="button"
                  className="ftd-secondary-button"
                  disabled={filteredRows.length === 0}
                  onClick={copyCurrentTable}
                >
                  Copiar tabela
                </button>
                <button
                  type="button"
                  className="ftd-secondary-button"
                  disabled={filteredRows.length === 0}
                  onClick={exportCurrentCsv}
                >
                  Exportar CSV
                </button>
              </div>
            </div>

            {filteredRows.length === 0 ? (
              <div className="ftd-empty-result">Nenhum resultado encontrado.</div>
            ) : (
              <>
                {activeView !== 'id' && (
                  <ImpactChart
                    rows={visibleRows}
                    nameKey={VIEWS[activeView].nameKey}
                    color={activeView === 'campaign' ? '#156f6d' : '#e85d3f'}
                  />
                )}
                <ResultTable view={activeView} rows={visibleRows} />
                <p className="ftd-result-count">
                  Exibindo {formatInteger(visibleRows.length)} de {formatInteger(filteredRows.length)}
                </p>
              </>
            )}
          </section>
        </>
      )}
    </main>
  );
}

function FileImport({ id, label, file, disabled, onSelect }) {
  return (
    <article className="ftd-file-import">
      <div>
        <h2>{label}</h2>
        {file ? (
          <p title={file.name}>
            <strong>{file.name}</strong>
            <span>{formatFileSize(file.size)}</span>
          </p>
        ) : (
          <p>Nenhum arquivo selecionado.</p>
        )}
      </div>
      <label className="ftd-file-button" htmlFor={id}>
        Selecionar CSV
        <input
          id={id}
          type="file"
          accept=".csv,text/csv"
          disabled={disabled}
          onChange={(event) => {
            onSelect(event.target.files?.[0] || null);
            event.target.value = '';
          }}
        />
      </label>
    </article>
  );
}

function ProgressPanel({ progress }) {
  const percentage =
    progress?.totalBytes > 0
      ? Math.min(100, Math.round((progress.loadedBytes / progress.totalBytes) * 100))
      : 0;

  return (
    <section className="ftd-progress" aria-live="polite">
      <div>
        <strong>{progress?.phase || 'Processando'}</strong>
        <span>{percentage}%</span>
      </div>
      <progress value={percentage} max="100" />
      <p>{formatInteger(progress?.rows || 0)} linhas lidas</p>
    </section>
  );
}

function SummaryCards({ summary }) {
  const cards = [
    ['Linhas da base FTD', formatInteger(summary.ftdRows)],
    ['IDs FTD unicos', formatInteger(summary.uniqueFtdIds)],
    ['Linhas do CRM', formatInteger(summary.crmRows)],
    ['Linhas CRM com match', formatInteger(summary.matchedCrmRows)],
    ['IDs FTD com campanha', formatInteger(summary.matchedFtdIds)],
    ['IDs FTD com match', `${formatDecimal(summary.matchPercentage)}%`],
    ['Maior campanha por IDs', summary.topCampaign || '-'],
    ['Maior template por IDs', summary.topTemplate || '-'],
  ];

  return (
    <section className="ftd-summary-grid" aria-label="Resumo do cruzamento">
      {cards.map(([label, value]) => (
        <article key={label}>
          <span>{label}</span>
          <strong title={String(value)}>{value}</strong>
        </article>
      ))}
    </section>
  );
}

function ImpactChart({ rows, nameKey, color }) {
  const chartHeight = Math.max(320, rows.length * 42);

  return (
    <div className="ftd-chart" style={{ height: chartHeight }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 8, right: 32, bottom: 8, left: 16 }}>
          <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 3" horizontal={false} />
          <XAxis type="number" allowDecimals={false} />
          <YAxis
            type="category"
            dataKey={nameKey}
            width={220}
            tickFormatter={(value) => truncateText(value, 30)}
          />
          <Tooltip
            formatter={(value) => [formatInteger(value), 'IDs impactados']}
            labelFormatter={(value) => String(value)}
          />
          <Bar dataKey="impactedIds" fill={color} radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function ResultTable({ view, rows }) {
  const table = getTableData(view, rows);

  return (
    <div className="ftd-table-wrap">
      <table className={view === 'id' ? 'ftd-table ftd-table--id' : 'ftd-table'}>
        <thead>
          <tr>
            {table.headers.map((header) => (
              <th key={header}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, rowIndex) => (
            <tr key={`${row[0]}-${rowIndex}`}>
              {row.map((cell, cellIndex) => (
                <td key={`${rowIndex}-${cellIndex}`} title={String(cell)}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function getViewRows(results, view) {
  if (!results) return [];
  if (view === 'campaign') return results.campaignImpact;
  if (view === 'template') return results.templateImpact;
  return results.resultById;
}

function filterViewRows(rows, view, search) {
  const query = normalizeSearch(search);
  if (!query) return rows;

  return rows.filter((row) => {
    if (view === 'campaign') return normalizeSearch(row.campaign).includes(query);
    if (view === 'template') return normalizeSearch(row.template).includes(query);

    return normalizeSearch(
      [
        row.id,
        row.topCampaign,
        ...(row.campaignNames || []),
        ...(row.templateNames || []),
      ].join(' '),
    ).includes(query);
  });
}

function getTableData(view, rows, formatValues = true) {
  if (view === 'campaign' || view === 'template') {
    const nameKey = VIEWS[view].nameKey;
    return {
      headers: [
        VIEWS[view].nameLabel,
        'IDs FTD unicos impactados',
        'Total de envios',
        'Total de giros',
        'Soma de bonus_cost_value',
      ],
      rows: rows.map((row) => [
        row[nameKey],
        formatValues ? formatInteger(row.impactedIds) : row.impactedIds,
        formatValues ? formatInteger(row.totalSends) : row.totalSends,
        formatValues ? formatDecimal(row.totalAmount) : row.totalAmount,
        formatValues ? formatDecimal(row.totalCost) : row.totalCost,
      ]),
    };
  }

  return {
    headers: [
      'ID',
      'FTD',
      'Saque',
      'NET',
      'Possui match no CRM',
      'Total de recebimentos',
      'Campanhas distintas',
      'Templates distintos',
      'Campanha mais recebida',
      'Qtd campanha principal',
      'Primeira campanha',
      'Ultima campanha',
      'Total de giros recebidos',
      'Custo recebido',
    ],
    rows: rows.map((row) => [
      row.id,
      row.ftd,
      row.saque,
      row.net,
      row.hasMatch,
      formatValues ? formatInteger(row.totalReceipts) : row.totalReceipts,
      formatValues ? formatInteger(row.distinctCampaigns) : row.distinctCampaigns,
      formatValues ? formatInteger(row.distinctTemplates) : row.distinctTemplates,
      row.topCampaign,
      formatValues ? formatInteger(row.topCampaignReceipts) : row.topCampaignReceipts,
      row.firstCampaign,
      row.lastCampaign,
      formatValues ? formatDecimal(row.totalSpins) : row.totalSpins,
      formatValues ? formatDecimal(row.receivedCost) : row.receivedCost,
    ]),
  };
}

function formatInteger(value) {
  return new Intl.NumberFormat('pt-BR').format(value || 0);
}

function formatDecimal(value) {
  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value || 0);
}

function formatFileSize(bytes) {
  if (!bytes) return '0 KB';
  const units = ['bytes', 'KB', 'MB', 'GB'];
  const power = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** power).toLocaleString('pt-BR', {
    maximumFractionDigits: 1,
  })} ${units[power]}`;
}

function normalizeSearch(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function truncateText(value, maxLength) {
  const text = String(value || '');
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}

function escapeMarkdownCell(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ');
}

function buildMarkdownTable(headers, rows) {
  const header = `| ${headers.map(escapeMarkdownCell).join(' | ')} |`;
  const separator = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map((row) => `| ${row.map(escapeMarkdownCell).join(' | ')} |`);
  return [header, separator, ...body].join('\n');
}

function buildCsv(headers, rows) {
  return [headers, ...rows]
    .map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\r\n');
}

async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textArea = document.createElement('textarea');
  textArea.value = text;
  textArea.style.position = 'fixed';
  textArea.style.opacity = '0';
  document.body.appendChild(textArea);
  textArea.select();
  document.execCommand('copy');
  textArea.remove();
}

function downloadText(content, fileName, type) {
  const blob = new Blob(['\uFEFF', content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}
