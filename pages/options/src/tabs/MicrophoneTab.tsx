import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@doeverything/ui';
import { Mic, MicOff } from 'lucide-react';
import { useEffect, useState } from 'react';

/**
 * MicrophoneTab — grants mic access for the chrome-extension:// origin.
 *
 * The side panel's dictation button can't reliably surface Chrome's
 * permission prompt, so the grant happens here in a full tab (getUserMedia
 * shows the prompt, then the track is stopped immediately). Once granted,
 * the whole extension origin — side panel included — can use the mic.
 *
 * The card reflects the REAL permission state via the Permissions API and
 * follows changes live (e.g. the user flips it in chrome://settings).
 */

type MicPermission = 'unknown' | 'granted' | 'denied' | 'prompt';

export function MicrophoneTab() {
  const [permission, setPermission] = useState<MicPermission>('unknown');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let status: PermissionStatus | null = null;

    const apply = (state: PermissionState) => {
      if (active) setPermission(state);
    };

    navigator.permissions
      .query({ name: 'microphone' })
      .then(result => {
        status = result;
        apply(result.state);
        result.onchange = () => apply(result.state);
      })
      .catch(() => {
        // Permissions API unavailable — leave state unknown; the request
        // button still works.
      });

    return () => {
      active = false;
      if (status) status.onchange = null;
    };
  }, []);

  const requestAccess = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(t => t.stop());
      setPermission('granted');
    } catch (err) {
      setPermission('denied');
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const description =
    permission === 'granted'
      ? 'Microphone access granted — the dictation button in the side panel chat is ready to use.'
      : permission === 'denied'
        ? 'Microphone access was denied. Re-enable it in chrome://settings/content/microphone, then request again.'
        : 'Permission has not been granted yet. Click below — Chrome will show the permission prompt.';

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Microphone</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          doeverything transcribes voice prompts in the side panel chat (the mic button in the composer). Granting access
          here covers the whole extension, side panel included.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {permission === 'granted' ? <Mic className="text-success h-4 w-4" /> : <MicOff className="h-4 w-4" />}
            Permission
          </CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={requestAccess} disabled={permission === 'granted'}>
            <Mic className="h-4 w-4" /> {permission === 'granted' ? 'Access granted' : 'Request access'}
          </Button>
          {error && <p className="text-destructive mt-2 text-xs">{error}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
