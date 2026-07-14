import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import './managementAnalyzer.css';

const METRICS = {
  deposits: { label: 'Depósitos', short: 'Depósitos', type: 'currency', color: '#156f6d' },
  netPercent: { label: 'Net', short: 'Net', type: 'percent', color: '#e85d3f' },
  netValue: { label: 'Valor / Net depósitos', short: 'Valor Net', type: 'currency', color: '#243b6b' },
  bonus: { label: 'Bônus', short: 'Bônus', type: 'currency', color: '#8a5a00' },
  registrations: { label: 'Registro de usuários', short: 'Registros', type: 'integer', color: '#7c3aed' },
  clubVip: { label: 'Clube VIP', short: 'Clube VIP', type: 'currency', color: '#0f766e' },
  referralBonus: { label: 'Bônus de indicação', short: 'Indicação', type: 'currency', color: '#b54708' },
  walletBalance: { label: 'Saldo de carteira', short: 'Saldo', type: 'currency', color: '#475467' },
  casinoGgr: { label: 'GGR Cassino', short: 'GGR Cassino', type: 'currency', color: '#2563eb' },
  sportsGgr: { label: 'GGR Esportes', short: 'GGR Esportes', type: 'currency', color: '#db2777' },
  promotionCost: { label: 'Promoções / Clube VIP', short: 'Promoções', type: 'currency', color: '#0f766e' },
  spinsAwarded: { label: 'Giros e premiações', short: 'Giros/premiações', type: 'decimal', color: '#8a5a00' },
  cashback: { label: 'Cashback concedido', short: 'Cashback', type: 'currency', color: '#7c3aed' },
  bonusRows: { label: 'Concessões de bônus', short: 'Concessões', type: 'integer', color: '#475467' },
};

const INITIAL_STATE = { status: 'idle', error: '', progress: null, results: null };

export default function ManagementAnalyzer() {
  const [file, setFile] = useState(null);
  const [referenceDate, setReferenceDate] = useState('');
  const [processState, setProcessState] = useState(INITIAL_STATE);
  const [filters, setFilters] = useState({ dateStart: '', dateEnd: '', hourStart: 0, hourEnd: 23, brand: '' });
  const [chartMetrics, setChartMetrics] = useState([]);
  const [feedback, setFeedback] = useState('');
  const workerRef = useRef(null);
  const feedbackTimerRef = useRef(null);

  useEffect(() => () => {
    workerRef.current?.terminate();
    window.clearTimeout(feedbackTimerRef.current);
  }, []);

  const results = processState.results;
  const filteredPoints = useMemo(() => filterPoints(results?.points || [], filters), [results, filters]);
  const summary = useMemo(() => buildSummary(results?.points || [], filteredPoints, filters, results?.availableMetrics || []), [results, filteredPoints, filters]);
  const report = useMemo(() => buildReport(results, filters, summary, filteredPoints), [results, filters, summary, filteredPoints]);
  const chartData = useMemo(() => filteredPoints.map((point) => ({ ...point, label: formatPointLabel(point, results?.dates?.length > 1) })), [filteredPoints, results]);
  const canProcess = Boolean(file && processState.status !== 'processing');

  function selectFile(selectedFile) {
    if (!selectedFile) return;
    if (!selectedFile.name.toLowerCase().endsWith('.csv')) {
      setFile(null);
      setProcessState({ status: 'error', error: 'Formato não suportado. Selecione um arquivo CSV.', progress: null, results: null });
      return;
    }
    setFile(selectedFile);
    setProcessState(INITIAL_STATE);
    setFeedback('');
  }

  function processFile() {
    if (!canProcess) return;
    workerRef.current?.terminate();
    const worker = new Worker(new URL('../../workers/managementAnalyzer.worker.js', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    setProcessState({ status: 'processing', error: '', progress: { loadedBytes: 0, totalBytes: file.size }, results: null });

    worker.onmessage = (event) => {
      const { type, payload } = event.data;
      if (type === 'progress') {
        setProcessState((current) => ({ ...current, progress: payload }));
        return;
      }
      if (type === 'done') {
        const defaultMetrics = chooseDefaultMetrics(payload.availableMetrics);
        setProcessState({ status: 'done', error: '', progress: null, results: payload });
        setFilters({
          dateStart: payload.dates[0] || '',
          dateEnd: payload.dates.at(-1) || '',
          hourStart: 0,
          hourEnd: 23,
          brand: '',
        });
        setChartMetrics(defaultMetrics);
        worker.terminate();
        if (workerRef.current === worker) workerRef.current = null;
        return;
      }
      if (type === 'error') finishWithError(payload.message, worker);
    };
    worker.onerror = (error) => finishWithError(error.message || 'Erro inesperado no processamento local.', worker);
    worker.postMessage({ file, referenceDate });
  }

  function finishWithError(message, worker) {
    setProcessState({ status: 'error', error: message, progress: null, results: null });
    worker.terminate();
    if (workerRef.current === worker) workerRef.current = null;
  }

  async function copyReport() {
    await navigator.clipboard.writeText(report);
    showFeedback('Relatório copiado');
  }

  function showFeedback(message) {
    window.clearTimeout(feedbackTimerRef.current);
    setFeedback(message);
    feedbackTimerRef.current = window.setTimeout(() => setFeedback(''), 1800);
  }

  return (
    <main className="management-module">
      <header className="management-header">
        <div>
          <p className="management-eyebrow">Análise local de CSV</p>
          <h1>Monitoramento gerencial</h1>
          <p className="management-subtitle">Acompanhe resultados por data e corte horário, sem enviar os dados para nenhum servidor.</p>
        </div>
        <button type="button" className="management-primary" disabled={!canProcess} onClick={processFile}>
          {processState.status === 'processing' ? 'Processando…' : 'Analisar CSV'}
        </button>
      </header>

      <section className="management-import" aria-label="Importação do CSV gerencial">
        <label className="management-file-field" htmlFor="management-file">
          <span>Arquivo CSV</span>
          <strong>{file?.name || 'Selecionar arquivo'}</strong>
          <small>{file ? formatFileSize(file.size) : 'Histórico de bônus ou relatório gerencial'}</small>
          <input id="management-file" type="file" accept=".csv,text/csv" disabled={processState.status === 'processing'} onChange={(event) => selectFile(event.target.files?.[0])} />
        </label>
        <label className="management-date-field">
          <span>Data de referência <small>(se o CSV não tiver Data)</small></span>
          <input type="date" value={referenceDate} disabled={processState.status === 'processing'} onChange={(event) => setReferenceDate(event.target.value)} />
        </label>
      </section>

      {processState.status === 'processing' && <Progress progress={processState.progress} />}
      {processState.error && <div className="management-alert management-alert--error" role="alert">{processState.error}</div>}

      {results && (
        <>
          <section className="management-source-summary">
            <div><span>Formato reconhecido</span><strong>{results.schemaType === 'bonus' ? 'Histórico de bônus' : 'Relatório gerencial'}</strong></div>
            <div><span>Período encontrado</span><strong>{formatDate(results.dates[0])} a {formatDate(results.dates.at(-1))}</strong></div>
            <div><span>Linhas utilizadas</span><strong>{formatInteger(results.sourceRows)}</strong></div>
          </section>

          {results.warnings.map((warning) => <div className="management-alert" key={warning}>{warning}</div>)}

          <Filters results={results} filters={filters} setFilters={setFilters} />

          {filteredPoints.length === 0 ? (
            <div className="management-empty">Nenhum ponto horário encontrado para os filtros selecionados.</div>
          ) : (
            <>
              <section className="management-cards" aria-label="Indicadores do período">
                {results.availableMetrics.map((metric) => (
                  <article className="management-card" key={metric}>
                    <span>{METRICS[metric].label}</span>
                    <strong>{formatMetric(summary[metric], METRICS[metric].type)}</strong>
                    <small>{filters.hourStart > 0 && metric !== 'walletBalance' && metric !== 'netPercent' ? 'Movimento no recorte' : 'Resultado no recorte'}</small>
                  </article>
                ))}
              </section>

              <section className="management-panel">
                <div className="management-panel-header">
                  <div><p className="management-kicker">Evolução hora a hora</p><h2>Curva dos indicadores</h2></div>
                  <div className="management-metric-picks">
                    {results.availableMetrics.map((metric) => (
                      <label key={metric}>
                        <input type="checkbox" checked={chartMetrics.includes(metric)} onChange={() => setChartMetrics((current) => current.includes(metric) ? current.filter((item) => item !== metric) : current.length < 3 ? [...current, metric] : current)} />
                        {METRICS[metric].short}
                      </label>
                    ))}
                  </div>
                </div>
                <p className="management-chart-hint">Selecione até 3 indicadores. Os pontos representam a posição acumulada em cada corte de :50.</p>
                <div className="management-chart">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 16, right: 22, left: 12, bottom: 6 }}>
                      <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
                      <XAxis dataKey="label" minTickGap={24} tick={{ fill: 'var(--muted)', fontSize: 12 }} />
                      <YAxis tickFormatter={compactNumber} width={72} tick={{ fill: 'var(--muted)', fontSize: 12 }} />
                      <Tooltip content={<ChartTooltip metrics={chartMetrics} />} />
                      <Legend />
                      {chartMetrics.map((metric) => <Line key={metric} type="monotone" dataKey={metric} name={METRICS[metric].short} stroke={METRICS[metric].color} strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} />)}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </section>

              <section className="management-panel">
                <div className="management-panel-header"><div><p className="management-kicker">Dados detalhados</p><h2>Tabela por horário</h2></div></div>
                <div className="management-table-wrap">
                  <table>
                    <thead><tr><th>Data</th><th>Hora</th><th>Marca</th>{results.availableMetrics.map((metric) => <th key={metric}>{METRICS[metric].short}</th>)}</tr></thead>
                    <tbody>{filteredPoints.map((point) => (
                      <tr key={`${point.date}-${point.hour}-${point.brand}`}><td>{formatDate(point.date)}</td><td>{point.time}</td><td>{point.brand}</td>{results.availableMetrics.map((metric) => <td key={metric}>{formatMetric(point[metric], METRICS[metric].type)}</td>)}</tr>
                    ))}</tbody>
                  </table>
                </div>
              </section>

              <section className="management-report">
                <div className="management-panel-header">
                  <div><p className="management-kicker">Leitura executiva</p><h2>Resumo automático</h2></div>
                  <div className="management-report-actions"><button type="button" onClick={copyReport}>Copiar relatório</button>{feedback && <span role="status">{feedback}</span>}</div>
                </div>
                <div className="management-report-text">{report.split('\n').map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</div>
              </section>
            </>
          )}
        </>
      )}
    </main>
  );
}

function Filters({ results, filters, setFilters }) {
  const update = (key, value) => setFilters((current) => ({ ...current, [key]: value }));
  return (
    <section className="management-filters" aria-label="Filtros da análise">
      <label><span>Data inicial</span><input type="date" min={results.dates[0]} max={filters.dateEnd || results.dates.at(-1)} value={filters.dateStart} onChange={(event) => update('dateStart', event.target.value)} /></label>
      <label><span>Data final</span><input type="date" min={filters.dateStart || results.dates[0]} max={results.dates.at(-1)} value={filters.dateEnd} onChange={(event) => update('dateEnd', event.target.value)} /></label>
      <label><span>Hora inicial</span><select value={filters.hourStart} onChange={(event) => update('hourStart', Number(event.target.value))}>{hourOptions(0, filters.hourEnd)}</select></label>
      <label><span>Hora final</span><select value={filters.hourEnd} onChange={(event) => update('hourEnd', Number(event.target.value))}>{hourOptions(filters.hourStart, 23)}</select></label>
      <label><span>Marca / operação</span><select value={filters.brand} onChange={(event) => update('brand', event.target.value)}><option value="">Todas</option>{results.brands.map((brand) => <option key={brand} value={brand}>{brand}</option>)}</select></label>
    </section>
  );
}

function Progress({ progress }) {
  const percent = progress?.totalBytes ? Math.round((progress.loadedBytes / progress.totalBytes) * 100) : 0;
  return <div className="management-progress" role="status"><div><strong>Processando localmente…</strong><span>{percent}%</span></div><progress max="100" value={percent} /></div>;
}

function ChartTooltip({ active, payload, label, metrics }) {
  if (!active || !payload?.length) return null;
  return <div className="management-tooltip"><strong>{label}</strong>{metrics.map((metric) => <span key={metric} style={{ color: METRICS[metric].color }}>{METRICS[metric].short}: {formatMetric(payload[0]?.payload?.[metric], METRICS[metric].type)}</span>)}</div>;
}

function filterPoints(points, filters) {
  return points.filter((point) =>
    (!filters.dateStart || point.date >= filters.dateStart) &&
    (!filters.dateEnd || point.date <= filters.dateEnd) &&
    point.hour >= filters.hourStart && point.hour <= filters.hourEnd &&
    (!filters.brand || point.brand === filters.brand),
  );
}

function buildSummary(allPoints, filteredPoints, filters, availableMetrics) {
  if (!filteredPoints.length) return {};
  const groups = new Map();
  filteredPoints.forEach((point) => {
    const key = `${point.date}|${point.brand}`;
    if (!groups.has(key) || groups.get(key).hour < point.hour) groups.set(key, point);
  });
  const summary = {};
  availableMetrics.forEach((metric) => {
    if (metric === 'walletBalance') {
      summary[metric] = [...groups.values()].sort((a, b) => a.date.localeCompare(b.date) || a.hour - b.hour).at(-1)?.[metric] || 0;
      return;
    }
    if (metric === 'netPercent') return;
    summary[metric] = [...groups.values()].reduce((total, endpoint) => {
      const baseline = filters.hourStart > 0
        ? allPoints.filter((point) => point.date === endpoint.date && point.brand === endpoint.brand && point.hour < filters.hourStart).at(-1)
        : null;
      return total + (Number(endpoint[metric]) || 0) - (Number(baseline?.[metric]) || 0);
    }, 0);
  });
  if (availableMetrics.includes('netPercent')) {
    if (availableMetrics.includes('netValue') && availableMetrics.includes('deposits') && summary.deposits) summary.netPercent = (summary.netValue / summary.deposits) * 100;
    else summary.netPercent = [...groups.values()].reduce((total, point) => total + (point.netPercent || 0), 0) / groups.size;
  }
  return summary;
}

function buildReport(results, filters, summary, points) {
  if (!results || !points.length) return '';
  const period = filters.dateStart === filters.dateEnd ? `em ${formatDate(filters.dateStart)}` : `de ${formatDate(filters.dateStart)} a ${formatDate(filters.dateEnd)}`;
  const brand = filters.brand || (results.brands.length === 1 ? results.brands[0] : 'todas as marcas');
  const lines = [`Monitoramento ${period}, entre ${formatHour(filters.hourStart)} e ${formatHour(filters.hourEnd)}, considerando ${brand}.`];
  if (results.schemaType === 'bonus') {
    lines.push(`Foram identificadas ${formatInteger(summary.bonusRows)} concessões, com custo financeiro estimado de ${formatCurrency(summary.promotionCost)}, ${formatDecimal(summary.spinsAwarded)} giros/premiações e ${formatCurrency(summary.cashback)} em cashback.`);
    lines.push('O arquivo analisado não contém depósitos, registros, saldo ou GGR; para incluir esses indicadores, importe o CSV gerencial que possua essas colunas.');
  } else {
    const available = results.availableMetrics;
    const keyParts = [];
    if (available.includes('deposits')) keyParts.push(`${formatCurrency(summary.deposits)} em depósitos`);
    if (available.includes('netValue')) keyParts.push(`${formatCurrency(summary.netValue)} de valor Net`);
    if (available.includes('netPercent')) keyParts.push(`Net de ${formatPercent(summary.netPercent)}`);
    if (available.includes('registrations')) keyParts.push(`${formatInteger(summary.registrations)} registros de usuários`);
    lines.push(keyParts.length ? `No recorte, o resultado consolidado foi de ${joinNatural(keyParts)}.` : 'O recorte foi consolidado com os indicadores disponíveis no arquivo.');
    const operationParts = [];
    if (available.includes('clubVip')) operationParts.push(`${formatCurrency(summary.clubVip)} em Clube VIP`);
    if (available.includes('casinoGgr')) operationParts.push(`${formatCurrency(summary.casinoGgr)} de GGR Cassino`);
    if (available.includes('sportsGgr')) operationParts.push(`${formatCurrency(summary.sportsGgr)} de GGR Esportes`);
    if (available.includes('walletBalance')) operationParts.push(`saldo final de ${formatCurrency(summary.walletBalance)}`);
    if (operationParts.length) lines.push(`Os demais destaques são ${joinNatural(operationParts)}.`);
  }
  return lines.join('\n');
}

function chooseDefaultMetrics(metrics) {
  const preferred = ['deposits', 'netValue', 'casinoGgr', 'promotionCost', 'spinsAwarded'];
  return preferred.filter((metric) => metrics.includes(metric)).slice(0, 3).concat(metrics.filter((metric) => !preferred.includes(metric)).slice(0, Math.max(0, 3 - preferred.filter((metric) => metrics.includes(metric)).length)));
}

function hourOptions(start, end) { return Array.from({ length: end - start + 1 }, (_, index) => start + index).map((hour) => <option key={hour} value={hour}>{formatHour(hour)}</option>); }
function formatHour(hour) { return `${String(hour).padStart(2, '0')}:50`; }
function formatDate(date) { if (!date) return '—'; const [year, month, day] = date.split('-'); return `${day}/${month}/${year}`; }
function formatPointLabel(point, showDate) { return showDate ? `${point.date.slice(8, 10)}/${point.date.slice(5, 7)} ${point.time}` : point.time; }
function formatInteger(value) { return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(value || 0); }
function formatDecimal(value) { return new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value || 0); }
function formatCurrency(value) { return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value || 0); }
function formatPercent(value) { return `${formatDecimal(value)}%`; }
function formatMetric(value, type) { if (type === 'currency') return formatCurrency(value); if (type === 'percent') return formatPercent(value); if (type === 'integer') return formatInteger(value); return formatDecimal(value); }
function compactNumber(value) { return new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 }).format(value || 0); }
function formatFileSize(bytes) { return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB` : `${(bytes / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} KB`; }
function joinNatural(items) { return items.length <= 1 ? items[0] || '' : `${items.slice(0, -1).join(', ')} e ${items.at(-1)}`; }
