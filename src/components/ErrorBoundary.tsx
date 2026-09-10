import React, { ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { clearAllPersistedAppData } from '../app/persistence';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  resetNonce: number;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      resetNonce: 0,
    };
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, resetNonce: 0 };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught React error caught by ErrorBoundary:', error, errorInfo);
  }

  private handleReset = () => {
    this.setState((current) => ({ hasError: false, error: null, resetNonce: current.resetNonce + 1 }));
  };

  private handleReload = () => {
    window.location.reload();
  };

  private handleClearAllAndReload = () => {
    clearAllPersistedAppData();
    this.setState({ hasError: false, error: null });
    window.location.assign(window.location.pathname);
  };

  public override render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-paper p-6 text-ink font-sans">
          <div className="max-w-md w-full bg-surface border border-line p-6 rounded-md shadow-sm space-y-4">
            <div className="flex items-center gap-3 text-alert">
              <div className="w-10 h-10 rounded-full bg-alert-soft flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5 text-alert" />
              </div>
              <div>
                <h1 className="text-base font-bold text-ink">Something went wrong</h1>
                <p className="text-sm text-text-secondary">Something went wrong here. Your saved work should still be safe.</p>
              </div>
            </div>

            <div className="p-3 bg-mist rounded border border-line text-sm text-text-muted">
              We couldn’t load this page. Reloading should bring back your saved work.
            </div>

            <div className="flex flex-col sm:flex-row gap-2 pt-2">
              <button
                type="button"
                onClick={this.handleReset}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 min-h-[44px] bg-ink hover:bg-ink-soft text-white text-sm font-bold rounded-sm transition cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Try again</span>
              </button>
              <button
                type="button"
                onClick={this.handleReload}
                className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 min-h-[44px] bg-transparent hover:bg-mist text-text-secondary border border-line text-sm font-medium rounded-sm transition cursor-pointer"
                title="Clears saved Gadwal data and reloads the app"
              >
                <span>Reload page</span>
              </button>
              <button type="button" onClick={this.handleClearAllAndReload} className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 min-h-[44px] bg-transparent hover:bg-alert-soft text-alert border border-line text-sm font-medium rounded-sm transition cursor-pointer" title="Clears saved Gadwal data and reloads the app">
                <span>Clear saved data</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    return <React.Fragment key={this.state.resetNonce}>{this.props.children}</React.Fragment>;
  }
}
