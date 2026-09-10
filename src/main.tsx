import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import '@fontsource/inter/latin.css';
import '@fontsource/inter/latin-ext.css';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary';
import './index.css';
import { initWebVitalsReporting } from './utils/rum';

const rootElement = document.getElementById('root');

if (!rootElement) {
  const fallback = document.createElement('div');
  fallback.setAttribute('role', 'alert');
  fallback.style.cssText = 'min-height:100vh;display:grid;place-items:center;padding:2rem;font-family:Inter,Arial,sans-serif;color:#202426;background:#EDEEEE;text-align:center;';
  fallback.textContent = 'Gadwal couldn’t start. Reload the page and try again.';
  document.body.appendChild(fallback);
} else {
  createRoot(rootElement).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  );
}
