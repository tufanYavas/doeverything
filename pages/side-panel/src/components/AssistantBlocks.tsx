import {
  Badge,
  Button,
  Card,
  CardContent,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  cn,
} from '@doeverything/ui';
import {
  CheckCircle2,
  Code as CodeIcon,
  Copy,
  ExternalLink,
  FileText,
  ImageIcon,
  Link as LinkIcon,
  ListChecks,
  Loader2,
  XCircle,
} from 'lucide-react';
import { useState } from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';

function extractFilename(children: React.ReactNode): string | undefined {
  const text = typeof children === 'string'
    ? children
    : Array.isArray(children)
      ? children.filter(c => typeof c === 'string').join('')
      : '';
  const match = text.match(/[\w.-]+\.[a-z0-9]{1,8}/i);
  return match?.[0];
}

/**
 * AssistantBlockRenderer.
 *
 * Top-level block dispatcher. Routes `MessagePart`s and any extended block
 * types the agent might emit (markdown, citations, plan steps, artifacts,
 * screenshots, tool_results) to the right renderer.
 */

export type AssistantBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'image'; url: string; alt?: string; caption?: string }
  | { type: 'code'; language?: string; code: string; filename?: string }
  | { type: 'citation'; index: number; url: string; title?: string; snippet?: string }
  | {
      type: 'plan';
      title?: string;
      steps: Array<{ text: string; status?: 'pending' | 'done' | 'in_progress' | 'failed' }>;
    }
  | {
      type: 'artifact';
      kind: 'react' | 'html' | 'svg' | 'mermaid' | 'code';
      title: string;
      body: string;
      language?: string;
    }
  | { type: 'screenshot'; dataUrl: string; caption?: string }
  | { type: 'tool_call_summary'; toolName: string; status: 'running' | 'done' | 'error'; preview?: string };

export function AssistantBlockRenderer({ block }: { block: AssistantBlock }) {
  switch (block.type) {
    case 'text':
      return <MarkdownBlock text={block.text} />;
    case 'thinking':
      return (
        <div className="border-border/60 bg-muted/30 text-muted-foreground rounded-lg border border-dashed p-2 text-xs italic">
          {block.text}
        </div>
      );
    case 'image':
      return (
        <figure className="space-y-1">
          <img src={block.url} alt={block.alt ?? ''} className="border-border/60 rounded-xl border" />
          {block.caption && <figcaption className="text-muted-foreground text-xs">{block.caption}</figcaption>}
        </figure>
      );
    case 'code':
      return <CodeBlock code={block.code} language={block.language} filename={block.filename} />;
    case 'citation':
      return <CitationChip {...block} />;
    case 'plan':
      return <PlanDisplay title={block.title} steps={block.steps} />;
    case 'artifact':
      return <ArtifactBlock {...block} />;
    case 'screenshot':
      return <ScreenshotViewer dataUrl={block.dataUrl} caption={block.caption} />;
    case 'tool_call_summary':
      return <ToolCallSummaryChip {...block} />;
  }
}

/* ------------------------------------------------------------------ */
/* Markdown                                                           */
/* ------------------------------------------------------------------ */

export function MarkdownBlock({ text }: { text: string }) {
  // Typography-tuned to mimic ChatGPT's reading flow: roomy paragraph
  // spacing, distinct heading sizes, ordered/unordered lists with proper
  // bullets, and a dark inline-code chip. Code fences are routed to the
  // dedicated `CodeBlock` (header + copy button).
  return (
    <div
      className={cn(
        'max-w-none break-words text-current',
        // Paragraphs / spacing
        '[&>p:first-child]:mt-0 [&>p:last-child]:mb-0 [&>p]:my-3 [&>p]:leading-7',
        // Headings
        '[&>h1]:mb-3 [&>h1]:mt-6 [&>h1]:text-xl [&>h1]:font-semibold',
        '[&>h2]:mb-2 [&>h2]:mt-5 [&>h2]:text-lg [&>h2]:font-semibold',
        '[&>h3]:mb-2 [&>h3]:mt-4 [&>h3]:text-base [&>h3]:font-semibold',
        '[&>h4]:mb-1 [&>h4]:mt-3 [&>h4]:font-semibold',
        // Lists
        '[&>ul]:my-3 [&>ul]:list-disc [&>ul]:pl-6 [&_ul]:list-disc [&_ul]:pl-6',
        '[&>ol]:my-3 [&>ol]:list-decimal [&>ol]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6',
        '[&_li]:my-1 [&_li]:leading-7',
        // Blockquote / hr
        '[&>blockquote]:border-border [&>blockquote]:text-muted-foreground [&>blockquote]:my-3 [&>blockquote]:border-l-2 [&>blockquote]:pl-3 [&>blockquote]:italic',
        '[&>hr]:border-border [&>hr]:my-6',
        // Tables
        '[&_table]:my-3 [&_table]:w-full [&_table]:border-collapse [&_table]:text-sm',
        '[&_th]:border-border [&_th]:bg-muted/40 [&_th]:border [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:font-semibold',
        '[&_td]:border-border [&_td]:border [&_td]:px-2 [&_td]:py-1',
      )}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        // react-markdown v9's default urlTransform drops `data:` URLs as unsafe,
        // which kills LLM-emitted download links like `[file.csv](data:text/csv,...)`.
        // Allow data: through (still blocks javascript: by omission).
        urlTransform={url => (url.startsWith('data:') ? url : defaultUrlTransform(url))}
        components={{
          a: ({ node: _node, href, children, ...rest }) => {
            const isData = typeof href === 'string' && href.startsWith('data:');
            const filename = isData ? extractFilename(children) : undefined;
            return (
              <a
                href={href}
                {...(isData
                  ? { download: filename ?? 'download' }
                  : { target: '_blank', rel: 'noopener noreferrer' })}
                className="text-primary inline-flex items-center gap-0.5 underline underline-offset-2"
                {...rest}>
                {children}
                <ExternalLink className="h-3 w-3" aria-hidden="true" />
              </a>
            );
          },
          // react-markdown v9 dropped the `inline` prop on the `code`
          // component, so we route fenced code via `pre` (which only ever
          // wraps fenced blocks) and treat every `code` element on its own
          // as inline. This matches Claude's chat UI: backticked tokens like
          // `role="search"` or `tabId` render as a coloured inline word, not
          // a full-width pill or block.
          pre({ children }) {
            // The single child is a `<code className="language-X">…</code>`
            // element produced by react-markdown for fenced code. Pull the
            // language class + raw code out and route to CodeBlock.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const child: any = Array.isArray(children) ? children[0] : children;
            const className: string = child?.props?.className ?? '';
            const raw =
              typeof child?.props?.children === 'string'
                ? child.props.children
                : Array.isArray(child?.props?.children)
                  ? child.props.children.join('')
                  : String(child?.props?.children ?? '');
            const match = /language-([\w-]+)/.exec(className);
            return <CodeBlock language={match?.[1]} code={raw.replace(/\n$/, '')} />;
          },
          code({ className, children, ...props }: { className?: string; children?: React.ReactNode }) {
            // If react-markdown gave us a `language-*` class, the parent must
            // be a `<pre>` (handled above). Anything else is single-backtick
            // inline code → render as a coloured token.
            if (className && /language-/.test(className)) {
              return (
                <code className={className} {...props}>
                  {children}
                </code>
              );
            }
            return (
              <code className="text-primary font-medium" {...props}>
                {children}
              </code>
            );
          },
        }}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Code block                                                         */
/* ------------------------------------------------------------------ */

export function CodeBlock({ code, language, filename }: { code: string; language?: string; filename?: string }) {
  const [copied, setCopied] = useState(false);
  const lines = code.split('\n');
  const collapsed = lines.length > 30;
  const [expanded, setExpanded] = useState(!collapsed);
  const visible = expanded ? code : lines.slice(0, 30).join('\n');

  return (
    <div className="border-border/60 bg-muted/40 my-2 overflow-hidden rounded-lg border">
      <div className="border-border/60 bg-muted/60 text-muted-foreground flex items-center justify-between border-b px-2 py-1 text-[11px]">
        <div className="flex items-center gap-1.5">
          <CodeIcon className="h-3 w-3" />
          <span className="font-mono">{filename ?? language ?? 'code'}</span>
          {language && (
            <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
              {language}
            </Badge>
          )}
        </div>
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 rounded p-1">
          {copied ? <CheckCircle2 className="text-success h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 text-xs leading-relaxed">
        <code>{visible}</code>
      </pre>
      {collapsed && (
        <div className="border-border/60 border-t px-2 py-1">
          <button
            type="button"
            onClick={() => setExpanded(e => !e)}
            className="text-muted-foreground hover:text-foreground text-[11px]">
            {expanded ? 'Show less' : `Show all ${lines.length} lines`}
          </button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Citation                                                           */
/* ------------------------------------------------------------------ */

export function CitationChip({
  index,
  url,
  title,
  snippet,
}: {
  index: number;
  url: string;
  title?: string;
  snippet?: string;
}) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="bg-primary/15 text-primary hover:bg-primary/25 ml-0.5 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full px-1 text-[10px] font-semibold">
            [{index}]
          </a>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs space-y-1">
          <div className="flex items-center gap-1 text-xs">
            <LinkIcon className="h-3 w-3" />
            <span className="font-semibold">{title ?? new URL(url).hostname}</span>
          </div>
          {snippet && <p className="text-[11px] opacity-80">{snippet}</p>}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/* ------------------------------------------------------------------ */
/* Plan display                                                        */
/* ------------------------------------------------------------------ */

export function PlanDisplay({
  title,
  steps,
}: {
  title?: string;
  steps: Array<{ text: string; status?: 'pending' | 'done' | 'in_progress' | 'failed' }>;
}) {
  return (
    <Card className="my-2">
      <CardContent className="p-3">
        <div className="text-muted-foreground mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider">
          <ListChecks className="text-primary h-3 w-3" />
          {title ?? 'Plan'}
        </div>
        <ol className="space-y-1.5">
          {steps.map((step, idx) => {
            const Icon =
              step.status === 'done'
                ? CheckCircle2
                : step.status === 'in_progress'
                  ? Loader2
                  : step.status === 'failed'
                    ? XCircle
                    : CheckCircle2;
            const tone =
              step.status === 'done'
                ? 'text-success'
                : step.status === 'in_progress'
                  ? 'text-primary'
                  : step.status === 'failed'
                    ? 'text-destructive'
                    : 'text-muted-foreground';
            return (
              <li key={idx} className="flex items-start gap-2 text-sm">
                <Icon
                  className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', tone, step.status === 'in_progress' && 'animate-spin')}
                />
                <span className={cn('leading-snug', step.status === 'pending' && 'text-muted-foreground')}>
                  <span className="mr-1 text-xs opacity-70">{idx + 1}.</span>
                  {step.text}
                </span>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Artifact                                                            */
/* ------------------------------------------------------------------ */

export function ArtifactBlock({
  kind,
  title,
  body,
  language,
}: {
  kind: 'react' | 'html' | 'svg' | 'mermaid' | 'code';
  title: string;
  body: string;
  language?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Card className="border-primary/40 my-2">
      <CardContent className="p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="text-primary h-4 w-4" />
            <div className="flex flex-col">
              <span className="text-sm font-semibold">{title}</span>
              <span className="text-muted-foreground text-[11px] uppercase tracking-wide">{kind}</span>
            </div>
          </div>
          <Button size="sm" variant="outline" onClick={() => setOpen(o => !o)}>
            {open ? 'Hide' : 'Open'}
          </Button>
        </div>
        {open && (
          <div className="mt-2">
            <CodeBlock language={language ?? kind} code={body} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Screenshot                                                          */
/* ------------------------------------------------------------------ */

export function ScreenshotViewer({ dataUrl, caption }: { dataUrl: string; caption?: string }) {
  const [zoomed, setZoomed] = useState(false);
  return (
    <figure className="my-2">
      <button
        type="button"
        onClick={() => setZoomed(z => !z)}
        className="border-border/60 group relative block overflow-hidden rounded-xl border">
        <img
          src={dataUrl}
          alt={caption ?? 'screenshot'}
          className={cn('w-full transition', zoomed ? 'max-h-[70vh] object-contain' : 'max-h-48 object-cover')}
        />
        <span className="bg-background/80 absolute right-2 top-2 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] backdrop-blur">
          <ImageIcon className="h-3 w-3" />
          {zoomed ? 'Click to shrink' : 'Click to expand'}
        </span>
      </button>
      {caption && <figcaption className="text-muted-foreground mt-1 text-xs">{caption}</figcaption>}
    </figure>
  );
}

/* ------------------------------------------------------------------ */
/* Tool call summary chip                                              */
/* ------------------------------------------------------------------ */

export function ToolCallSummaryChip({
  toolName,
  status,
  preview,
}: {
  toolName: string;
  status: 'running' | 'done' | 'error';
  preview?: string;
}) {
  const tone =
    status === 'running'
      ? 'border-primary/30 bg-primary/10 text-primary'
      : status === 'error'
        ? 'border-destructive/25 bg-destructive/10 text-destructive'
        : 'border-border/60 bg-card';
  const Icon = status === 'running' ? Loader2 : status === 'error' ? XCircle : CheckCircle2;
  return (
    <div className={cn('inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px]', tone)}>
      <Icon className={cn('h-3 w-3', status === 'running' && 'animate-spin')} />
      <span className="font-mono">{toolName}</span>
      {preview && <span className="text-muted-foreground truncate">· {preview}</span>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Streaming text + AutoScroll button                                  */
/* ------------------------------------------------------------------ */

export function StreamingText({ text }: { text: string }) {
  return (
    <span className="inline">
      <MarkdownBlock text={text} />
    </span>
  );
}
