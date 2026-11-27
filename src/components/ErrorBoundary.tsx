import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
  isQuotaError: boolean;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      errorMessage: '',
      isQuotaError: false,
    };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    const rawMsg = error?.message || '发生未知错误';
    let displayMessage = '页面运行遇到异常，请尝试重新加载。';
    let isQuotaError = false;

    if (rawMsg.includes('Quota exceeded')) {
      isQuotaError = true;
      displayMessage = '云端数据库今日免费读写配额已达上限，将于明日自动重置。';
    } else {
      try {
        const parsed = JSON.parse(rawMsg);
        if (parsed?.error && typeof parsed.error === 'string') {
          if (parsed.error.includes('Quota exceeded')) {
            isQuotaError = true;
            displayMessage = '云端数据库今日免费读写配额已达上限，将于明日自动重置。';
          } else if (parsed.error.includes('permission') || parsed.error.includes('PERMISSION_DENIED')) {
            displayMessage = '对话记录访问权限校验未通过，请重新登录后重试。';
          }
        }
      } catch {
        // Non-JSON error message
      }
    }

    return {
      hasError: true,
      errorMessage: displayMessage,
      isQuotaError,
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error('Application ErrorBoundary caught an error:', error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, errorMessage: '', isQuotaError: false });
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
          <div className="max-w-md w-full bg-white rounded-2xl border border-rose-200 shadow-lg p-6 text-center space-y-4">
            <div className="w-12 h-12 rounded-full bg-rose-50 text-red-600 flex items-center justify-center mx-auto">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <h2 className="text-lg font-bold text-slate-900">
              {this.state.isQuotaError ? '云端存储配额提示' : '服务暂时遇到异常'}
            </h2>
            <p className="text-sm text-slate-600 leading-relaxed">{this.state.errorMessage}</p>
            <button
              type="button"
              onClick={this.handleReset}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-xl transition-colors cursor-pointer"
            >
              <RotateCcw className="w-4 h-4" />
              <span>刷新页面恢复</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
