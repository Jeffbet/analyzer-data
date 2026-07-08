import { useState } from 'react';
import App from './App.jsx';
import FtdAnalyzer from './modules/ftd/FtdAnalyzer.jsx';

export default function ModuleShell() {
  const [activeModule, setActiveModule] = useState('bonus');

  return (
    <>
      <nav className="module-navigation" aria-label="Modulos de analise">
        <button
          type="button"
          className={activeModule === 'bonus' ? 'is-active' : ''}
          aria-pressed={activeModule === 'bonus'}
          onClick={() => setActiveModule('bonus')}
        >
          Analise de bonus
        </button>
        <button
          type="button"
          className={activeModule === 'ftd' ? 'is-active' : ''}
          aria-pressed={activeModule === 'ftd'}
          onClick={() => setActiveModule('ftd')}
        >
          Cruzamento FTD
        </button>
      </nav>

      {activeModule === 'bonus' ? <App /> : <FtdAnalyzer />}
    </>
  );
}
