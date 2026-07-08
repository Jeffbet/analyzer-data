import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import ModuleShell from './ModuleShell.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ModuleShell />
  </StrictMode>,
);
