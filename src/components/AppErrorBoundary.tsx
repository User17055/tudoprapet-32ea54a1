import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Unexpected application error:", error, info);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-5">
        <div className="w-full max-w-md rounded-2xl border border-border bg-card p-7 text-center shadow-lg">
          <AlertTriangle className="mx-auto h-10 w-10 text-primary" />
          <h1 className="mt-4 text-xl font-extrabold text-foreground">
            Não foi possível carregar esta página
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Ocorreu um erro inesperado. Recarregue para tentar novamente.
          </p>
          <Button
            className="mt-5 gap-2"
            onClick={() => window.location.reload()}
          >
            <RefreshCw className="h-4 w-4" />
            Recarregar página
          </Button>
        </div>
      </main>
    );
  }
}
