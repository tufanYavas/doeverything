import { withErrorBoundary, withSuspense } from '@doeverything/shared';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ErrorDisplay,
  LoadingSpinner,
  BrandLogo,
} from '@doeverything/ui';
import { Download, Film } from 'lucide-react';
import { useEffect, useState } from 'react';

const GifViewer = () => {
  const [src, setSrc] = useState<string | null>(null);
  const [name, setName] = useState<string>('doe-recording.gif');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('id');
    const directSrc = params.get('src');
    if (directSrc) {
      setSrc(directSrc);
      return;
    }
    if (!id) return;
    chrome.storage.local
      .get(`doe/recording/${id}`)
      .then(record => {
        const entry = record?.[`doe/recording/${id}`] as { dataUrl?: string; name?: string } | undefined;
        if (entry?.dataUrl) {
          setSrc(entry.dataUrl);
          if (entry.name) setName(entry.name);
        }
      })
      .catch(() => undefined);
  }, []);

  return (
    <div className="bg-background text-foreground min-h-screen p-6">
      <div className="de-fade-up mx-auto flex max-w-3xl flex-col items-center gap-4">
        <BrandLogo size="md" />
        <Card className="w-full">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Film className="text-primary h-4 w-4" /> Workflow recording
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-4">
            {src ? (
              <>
                <img src={src} alt="doeverything recording" className="border-border/70 shadow-soft max-w-full rounded-xl border" />
                <Button asChild>
                  <a href={src} download={name}>
                    <Download className="h-4 w-4" /> Download
                  </a>
                </Button>
              </>
            ) : (
              <p className="text-muted-foreground text-sm">No recording loaded yet.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default withErrorBoundary(withSuspense(GifViewer, <LoadingSpinner />), ErrorDisplay);
