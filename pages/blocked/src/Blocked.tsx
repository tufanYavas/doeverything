import { withErrorBoundary, withSuspense } from '@doeverything/shared';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ErrorDisplay,
  LoadingSpinner,
  BrandLogo,
} from '@doeverything/ui';
import { ShieldAlert } from 'lucide-react';

const Blocked = () => {
  const params = new URLSearchParams(window.location.search);
  const target = params.get('url') ?? 'this URL';
  const reason = params.get('reason') ?? 'managed-policy match';

  return (
    <div className="bg-background text-foreground flex min-h-screen items-center justify-center p-6">
      <Card className="de-fade-up border-warning/40 w-full max-w-md overflow-hidden">
        <div className="border-warning/25 bg-warning/10 flex items-center gap-2.5 border-b px-6 py-3">
          <ShieldAlert className="text-warning h-4 w-4 shrink-0" />
          <span className="text-warning text-[11px] font-medium uppercase tracking-wider">Navigation blocked</span>
        </div>
        <CardHeader>
          <BrandLogo size="md" />
          <CardTitle className="pt-2 font-semibold tracking-tight">This site is blocked</CardTitle>
          <CardDescription>
            doeverything was asked to navigate to{' '}
            <code className="border-border/70 bg-muted/60 rounded-md border px-1 py-0.5 font-mono text-[11px] break-all">
              {target}
            </code>
            , but it matches a blocked URL pattern (<span className="font-mono text-[11px]">{reason}</span>).
          </CardDescription>
        </CardHeader>
        <CardContent className="text-muted-foreground text-xs">
          Ask your administrator to update the managed policy if this is unexpected.
        </CardContent>
      </Card>
    </div>
  );
};

export default withErrorBoundary(withSuspense(Blocked, <LoadingSpinner />), ErrorDisplay);
