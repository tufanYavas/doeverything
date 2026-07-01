import { buildConversationReportHtml  } from './conversation-report';
import { describe, expect, it } from 'vitest';
import type {TranscriptDTO} from './conversation-report';

function makeTranscript(over: Partial<TranscriptDTO> = {}): TranscriptDTO {
  return {
    runId: 'run-1',
    conversationId: 'conv-1',
    startedAt: 1_000,
    endedAt: 2_500,
    provider: 'anthropic',
    model: 'claude-opus-4',
    toolCalls: [],
    ...over,
  };
}

describe('buildConversationReportHtml', () => {
  it('renders a self-contained HTML document with the report title', () => {
    const html = buildConversationReportHtml({ conversationId: 'conv-1', title: 'My run', transcripts: [] });
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('<h1>doeverything Conversation Report</h1>');
    expect(html.trimEnd().endsWith('</html>')).toBe(true);
    // Inline CSS is embedded (no external assets).
    expect(html).toContain('<style>');
  });

  it('renders the summary stats (turns, tool calls, errors, token totals)', () => {
    const transcripts = [
      makeTranscript({
        startedAt: 0,
        endedAt: 1_000,
        toolCalls: [{ name: 'read_page', args: {} }],
        usage: { inputTokens: 100, outputTokens: 20, cachedInputTokens: 5 },
      }),
      makeTranscript({
        startedAt: 0,
        endedAt: 1_000,
        finishReason: 'error',
        toolCalls: [],
        usage: { inputTokens: 50, outputTokens: 10, cachedInputTokens: 0 },
      }),
    ];
    const html = buildConversationReportHtml({ conversationId: 'conv-1', title: 't', transcripts });
    // 2 turns.
    expect(html).toContain('<div class="sv">2</div><div class="sl">Turns</div>');
    // 1 tool call total.
    expect(html).toContain('<div class="sv">1</div><div class="sl">Tool Calls</div>');
    // 1 error (finishReason === 'error').
    expect(html).toContain('<div class="sv">1</div><div class="sl">Errors</div>');
    // Token totals: in 150, cache 5, out 30.
    expect(html).toContain('<div class="sv">150</div><div class="sl">Input Tokens</div>');
    expect(html).toContain('<div class="sv">5</div><div class="sl">Cached Tokens</div>');
    expect(html).toContain('<div class="sv">30</div><div class="sl">Output Tokens</div>');
  });

  it('shows the empty-state notice and skips per-turn cards when there are no transcripts', () => {
    const html = buildConversationReportHtml({ conversationId: 'conv-1', title: 't', transcripts: [] });
    expect(html).toContain('No transcripts captured yet');
    expect(html).not.toContain('class="card"');
    expect(html).not.toContain('Turn Timeline');
  });

  it('renders a per-turn card with provider/model meta and finish reason badge', () => {
    const html = buildConversationReportHtml({
      conversationId: 'conv-1',
      title: 't',
      transcripts: [makeTranscript({ finishReason: 'stop', provider: 'anthropic', model: 'claude-opus-4' })],
    });
    expect(html).toContain('id="turn0"');
    expect(html).toContain('anthropic/claude-opus-4');
    // finish reason rendered both as a badge and in the response label.
    expect(html).toContain('>stop</span>');
    expect(html).toContain('finish=stop');
  });

  it('renders tool calls with args and results', () => {
    const html = buildConversationReportHtml({
      conversationId: 'conv-1',
      title: 't',
      transcripts: [
        makeTranscript({
          toolCalls: [
            {
              name: 'navigate',
              args: { url: 'https://example.com' },
              result: { ok: true, status: 200 },
              startedAt: 10,
              endedAt: 60,
            },
          ],
        }),
      ],
    });
    expect(html).toContain('Tool Calls (1)');
    expect(html).toContain('[1] navigate');
    // args JSON
    expect(html).toContain('&quot;url&quot;: &quot;https://example.com&quot;');
    // result JSON
    expect(html).toContain('&quot;status&quot;: 200');
    // duration badge from startedAt/endedAt.
    expect(html).toContain('50ms');
  });

  it('marks errored tool calls and surfaces a turn-level error box', () => {
    const html = buildConversationReportHtml({
      conversationId: 'conv-1',
      title: 't',
      transcripts: [
        makeTranscript({
          finishReason: 'error',
          error: { type: 'RateLimit', message: 'too many requests', statusCode: 429 },
          toolCalls: [{ name: 'click', args: {}, result: 'boom', isError: true }],
        }),
      ],
    });
    expect(html).toContain('is-error');
    expect(html).toContain('[1] click · ERROR');
    expect(html).toContain('result (error)');
    // turn-level error box
    expect(html).toContain('RateLimit');
    expect(html).toContain('(HTTP 429)');
    expect(html).toContain('too many requests');
  });

  it('renders the token bar with input/cache/output segments', () => {
    const html = buildConversationReportHtml({
      conversationId: 'conv-1',
      title: 't',
      transcripts: [makeTranscript({ usage: { inputTokens: 300, outputTokens: 40, cachedInputTokens: 120 } })],
    });
    expect(html).toContain('in:300');
    expect(html).toContain('cache:120');
    expect(html).toContain('out:40');
  });

  it('renders request messages, including string and structured content parts', () => {
    const html = buildConversationReportHtml({
      conversationId: 'conv-1',
      title: 't',
      transcripts: [
        makeTranscript({
          system: 'You are a helpful agent.',
          tools: [{ name: 'read_page', description: 'Reads the page' }],
          messages: [
            { role: 'user', content: 'hello there' },
            {
              role: 'assistant',
              content: [
                { type: 'text', text: 'thinking out loud' },
                { type: 'tool-call', toolName: 'read_page', input: { tabId: 1 } },
              ],
            },
          ],
          responseText: 'final answer',
        }),
      ],
    });
    expect(html).toContain('System Prompt');
    expect(html).toContain('You are a helpful agent.');
    expect(html).toContain('Tool Roster (1)');
    expect(html).toContain('Reads the page');
    expect(html).toContain('Request Messages (2)');
    expect(html).toContain('messages[0] user');
    expect(html).toContain('hello there');
    expect(html).toContain('messages[1] assistant');
    expect(html).toContain('thinking out loud');
    expect(html).toContain('tool-call → read_page');
    // Reconstructed assistant response text.
    expect(html).toContain('Assistant text');
    expect(html).toContain('final answer');
  });

  it('escapes HTML in user/model content to prevent injection', () => {
    const payload = '<script>alert("xss")</script>';
    const html = buildConversationReportHtml({
      conversationId: '<conv>',
      title: '<b>title</b>',
      transcripts: [
        makeTranscript({
          messages: [{ role: 'user', content: payload }],
          responseText: payload,
          toolCalls: [{ name: payload, args: { evil: payload }, result: payload }],
        }),
      ],
    });
    // The raw script tag must never appear unescaped.
    expect(html).not.toContain('<script>alert');
    // It is escaped instead.
    expect(html).toContain('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    // Title and conversation id are escaped too.
    expect(html).toContain('&lt;b&gt;title&lt;/b&gt;');
    expect(html).toContain('&lt;conv&gt;');
  });

  it('shows a no-content note when a turn has neither text nor tool calls', () => {
    const html = buildConversationReportHtml({
      conversationId: 'conv-1',
      title: 't',
      transcripts: [makeTranscript({ responseText: undefined, toolCalls: [] })],
    });
    expect(html).toContain('(no assistant text or tool calls captured)');
  });

  it('renders the timeline and execution flow when there are transcripts', () => {
    const html = buildConversationReportHtml({
      conversationId: 'conv-1',
      title: 't',
      transcripts: [makeTranscript({ toolCalls: [{ name: 'scroll', args: {} }] })],
    });
    expect(html).toContain('Turn Timeline');
    expect(html).toContain('Execution Flow');
    expect(html).toContain('href="#turn0"');
    expect(html).toContain('scroll');
  });
});
