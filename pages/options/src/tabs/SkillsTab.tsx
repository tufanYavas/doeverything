import { parseSkillMarkdown, serializeSkillToMarkdown, useStorage } from '@doeverything/shared';
import { isValidSkillName, skillsStorage } from '@doeverything/storage';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  cn,
} from '@doeverything/ui';
import { Download, Pencil, Plus, Sparkles, Trash2, Upload } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SkillFrontmatter } from '@doeverything/shared';
import type { Skill } from '@doeverything/storage';

type EditorMode = 'fields' | 'markdown';

interface DraftFields {
  name: string;
  description: string;
  whenToUse: string;
  argumentHint: string;
  argumentNamesText: string;
  allowedToolsText: string;
  model: string;
  version: string;
  domainsText: string;
  body: string;
  userInvocable: boolean;
  disableModelInvocation: boolean;
}

const EMPTY_DRAFT: DraftFields = {
  name: '',
  description: '',
  whenToUse: '',
  argumentHint: '',
  argumentNamesText: '',
  allowedToolsText: '',
  model: '',
  version: '',
  domainsText: '',
  body: '',
  userInvocable: true,
  disableModelInvocation: false,
};

const SAMPLE_MARKDOWN = `---
name: research-competitor
description: Research a competitor and summarise three sources
when_to_use: When the user wants a quick competitive briefing on a company.
argument-hint: <company>
arguments: company
domains: []
---

You are researching $company. Open three relevant pages, extract the most important facts, and write a 5-bullet summary.
`;

const tokensFrom = (raw: string, sep: RegExp | string): string[] =>
  raw
    .split(sep as RegExp)
    .map(s => s.trim())
    .filter(Boolean);

function fieldsFromSkill(s: Skill): DraftFields {
  return {
    name: s.name,
    description: s.description,
    whenToUse: s.whenToUse ?? '',
    argumentHint: s.argumentHint ?? '',
    argumentNamesText: (s.argumentNames ?? []).join(' '),
    allowedToolsText: (s.allowedTools ?? []).join(', '),
    model: s.model ?? '',
    version: s.version ?? '',
    domainsText: (s.domains ?? []).join(', '),
    body: s.body,
    userInvocable: s.userInvocable ?? true,
    disableModelInvocation: s.disableModelInvocation ?? false,
  };
}

function fieldsToPayload(d: DraftFields): Omit<Skill, 'id' | 'createdAt' | 'updatedAt'> {
  const argumentNames = tokensFrom(d.argumentNamesText, /\s+/);
  const allowedTools = tokensFrom(d.allowedToolsText, ',');
  const domains = tokensFrom(d.domainsText, ',');
  return {
    name: d.name.trim(),
    description: d.description.trim(),
    whenToUse: d.whenToUse.trim() || undefined,
    argumentHint: d.argumentHint.trim() || undefined,
    argumentNames: argumentNames.length ? argumentNames : undefined,
    allowedTools: allowedTools.length ? allowedTools : undefined,
    model: d.model.trim() || undefined,
    version: d.version.trim() || undefined,
    domains: domains.length ? domains : undefined,
    body: d.body,
    userInvocable: d.userInvocable,
    disableModelInvocation: d.disableModelInvocation,
    source: 'user',
  };
}

function fieldsToMarkdown(d: DraftFields): string {
  const draftSkill: Skill = {
    ...fieldsToPayload(d),
    id: 'draft',
    createdAt: 0,
    updatedAt: 0,
  } as Skill;
  return serializeSkillToMarkdown(draftSkill);
}

function fieldsFromMarkdown(md: string, prev: DraftFields): DraftFields {
  const { frontmatter, body } = parseSkillMarkdown(md);
  return mergeFrontmatter(prev, frontmatter, body);
}

function mergeFrontmatter(prev: DraftFields, fm: SkillFrontmatter, body: string): DraftFields {
  const argumentsField = fm.arguments;
  const argumentNamesText =
    typeof argumentsField === 'string'
      ? argumentsField
      : Array.isArray(argumentsField)
        ? argumentsField.join(' ')
        : prev.argumentNamesText;
  const allowedToolsField = fm['allowed-tools'];
  const allowedToolsText =
    typeof allowedToolsField === 'string'
      ? allowedToolsField
      : Array.isArray(allowedToolsField)
        ? allowedToolsField.join(', ')
        : prev.allowedToolsText;
  const domainsField = (fm as { domains?: string | string[] }).domains;
  const domainsText =
    typeof domainsField === 'string'
      ? domainsField
      : Array.isArray(domainsField)
        ? domainsField.join(', ')
        : prev.domainsText;
  return {
    name: typeof fm.name === 'string' ? fm.name : prev.name,
    description: typeof fm.description === 'string' ? fm.description : prev.description,
    whenToUse: typeof fm.when_to_use === 'string' ? fm.when_to_use : prev.whenToUse,
    argumentHint: typeof fm['argument-hint'] === 'string' ? fm['argument-hint'] : prev.argumentHint,
    argumentNamesText,
    allowedToolsText,
    model: typeof fm.model === 'string' ? fm.model : prev.model,
    version: typeof fm.version === 'string' ? fm.version : prev.version,
    domainsText,
    body,
    userInvocable: fm['user-invocable'] === false ? false : true,
    disableModelInvocation: fm['disable-model-invocation'] === true,
  };
}

export function SkillsTab() {
  const skills = useStorage(skillsStorage);
  const [filter, setFilter] = useState('');
  const [editing, setEditing] = useState<Skill | null>(null);
  const [creating, setCreating] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [importMessage, setImportMessage] = useState<string | null>(null);

  const sorted = useMemo(() => [...skills].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)), [skills]);
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter(s => {
      const haystack = `${s.name}\n${s.description}\n${s.whenToUse ?? ''}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [sorted, filter]);

  const onDelete = useCallback(async (id: string) => {
    if (!confirm('Delete this skill? This cannot be undone.')) return;
    await skillsStorage.remove(id);
    void chrome.runtime.sendMessage({ type: 'doe/skills/reset-listing-sessions' });
  }, []);

  const onExportAll = useCallback(async () => {
    const json = await skillsStorage.exportAll();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `skills-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const onExportSingle = useCallback(async (s: Skill) => {
    const md = serializeSkillToMarkdown(s);
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${s.name}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const onImportFile = useCallback(async (file: File) => {
    setImportMessage(null);
    try {
      const text = await file.text();
      if (file.name.toLowerCase().endsWith('.json')) {
        const added = await skillsStorage.importAll(text);
        void chrome.runtime.sendMessage({ type: 'doe/skills/reset-listing-sessions' });
        setImportMessage(`Imported ${added} skill${added === 1 ? '' : 's'}.`);
      } else {
        const { frontmatter, body } = parseSkillMarkdown(text);
        const fallback = file.name.replace(/\.[^.]+$/, '');
        const draft = mergeFrontmatter({ ...EMPTY_DRAFT, name: fallback }, frontmatter, body);
        const payload = fieldsToPayload(draft);
        await skillsStorage.create({ ...payload, source: 'imported' });
        void chrome.runtime.sendMessage({ type: 'doe/skills/reset-listing-sessions' });
        setImportMessage(`Imported ${payload.name}.`);
      }
    } catch (e) {
      setImportMessage(e instanceof Error ? e.message : String(e));
    }
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Skills</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            User-authored procedures the agent can invoke. Markdown body plus YAML-style frontmatter;{' '}
            <code>$ARGUMENTS</code>, <code>$0</code>, <code>$name</code>, <code>${'{doeverything_TAB_ID}'}</code> and{' '}
            <code>${'{doeverything_SESSION_ID}'}</code> are substituted at invocation time.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
            <Upload className="h-3.5 w-3.5" /> Import
          </Button>
          <Button variant="outline" size="sm" onClick={onExportAll}>
            <Download className="h-3.5 w-3.5" /> Export all
          </Button>
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="h-3.5 w-3.5" /> New skill
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,.md"
            className="hidden"
            onChange={e => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void onImportFile(file);
            }}
          />
        </div>
      </div>

      <Input
        value={filter}
        onChange={e => setFilter(e.target.value)}
        placeholder="Filter by name, description, or when-to-use…"
      />

      {importMessage && (
        <div className="text-muted-foreground border-border/70 bg-muted/30 rounded-lg border px-3 py-1.5 text-xs">{importMessage}</div>
      )}

      {filtered.length === 0 ? (
        <Card>
          <CardContent className="text-muted-foreground py-10 text-center text-sm">
            {skills.length === 0
              ? 'No skills yet. Click "New skill" or import a SKILL.md to get started.'
              : 'No skills match the filter.'}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-2">
          {filtered.map(skill => (
            <Card key={skill.id} className="hover:border-primary/40 transition-colors duration-150">
              <CardContent className="flex items-start justify-between gap-3 p-3">
                <button
                  type="button"
                  onClick={() => setEditing(skill)}
                  className="flex flex-1 flex-col items-start text-left">
                  <div className="flex items-baseline gap-2">
                    <span className="text-primary font-mono text-sm">/{skill.name}</span>
                    {skill.argumentHint && (
                      <span className="text-muted-foreground font-mono text-xs">{skill.argumentHint}</span>
                    )}
                    {skill.disableModelInvocation && <Badge variant="secondary">user-only</Badge>}
                    {skill.userInvocable === false && <Badge variant="secondary">model-only</Badge>}
                    {skill.source === 'imported' && <Badge variant="outline">imported</Badge>}
                  </div>
                  {skill.description && <p className="mt-1 line-clamp-2 text-sm">{skill.description}</p>}
                  {skill.whenToUse && (
                    <p className="text-muted-foreground mt-0.5 line-clamp-2 text-xs">
                      <span className="font-medium">When:</span> {skill.whenToUse}
                    </p>
                  )}
                </button>
                <div className="flex shrink-0 gap-1">
                  <Button variant="ghost" size="icon" onClick={() => setEditing(skill)} aria-label="Edit">
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => onExportSingle(skill)} aria-label="Export">
                    <Download className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onDelete(skill.id)}
                    aria-label="Delete"
                    className="text-muted-foreground hover:text-destructive">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <SkillEditorDialog
        open={creating || editing !== null}
        skill={editing}
        onOpenChange={open => {
          if (!open) {
            setEditing(null);
            setCreating(false);
          }
        }}
      />
    </div>
  );
}

interface SkillEditorDialogProps {
  open: boolean;
  skill: Skill | null;
  onOpenChange: (open: boolean) => void;
}

function SkillEditorDialog({ open, skill, onOpenChange }: SkillEditorDialogProps) {
  const [mode, setMode] = useState<EditorMode>('fields');
  const [draft, setDraft] = useState<DraftFields>(EMPTY_DRAFT);
  const [markdown, setMarkdown] = useState<string>(SAMPLE_MARKDOWN);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Sync external skill → draft + markdown when opened.
  useEffect(() => {
    if (!open) return;
    if (skill) {
      const f = fieldsFromSkill(skill);
      setDraft(f);
      setMarkdown(fieldsToMarkdown(f));
    } else {
      setDraft(EMPTY_DRAFT);
      setMarkdown(SAMPLE_MARKDOWN);
    }
    setError(null);
    setMode('fields');
  }, [open, skill]);

  // Live mirror: when `fields` mode edits change, regenerate markdown.
  useEffect(() => {
    if (!open || mode !== 'fields') return;
    setMarkdown(fieldsToMarkdown(draft));
  }, [draft, mode, open]);

  // When in markdown mode, parse markdown back into the live preview fields.
  useEffect(() => {
    if (!open || mode !== 'markdown') return;
    setDraft(prev => fieldsFromMarkdown(markdown, prev));
  }, [markdown, mode, open]);

  const handleSave = useCallback(async () => {
    setError(null);
    const payload = fieldsToPayload(draft);
    if (!payload.name) return setError('Name is required.');
    if (!isValidSkillName(payload.name)) {
      return setError("Name may only contain letters, numbers, ':', '_' and '-'.");
    }
    if (!payload.description) return setError('Description is required.');
    if (!payload.body.trim()) return setError('Body cannot be empty.');
    try {
      setSaving(true);
      if (skill) {
        await skillsStorage.update(skill.id, { ...payload, source: skill.source });
      } else {
        await skillsStorage.create(payload);
      }
      void chrome.runtime.sendMessage({ type: 'doe/skills/reset-listing-sessions' });
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [draft, skill, onOpenChange]);

  const previewName = draft.name.trim() || (skill?.name ?? 'untitled');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="text-primary h-4 w-4" />
            {skill ? `Edit /${skill.name}` : 'New skill'}
          </DialogTitle>
          <DialogDescription>
            Frontmatter (parsed live) plus markdown body. The body becomes the user-message the agent runs when this
            skill is invoked.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={mode} onValueChange={v => setMode(v as EditorMode)} className="space-y-4">
          <TabsList>
            <TabsTrigger value="fields">Fields</TabsTrigger>
            <TabsTrigger value="markdown">Markdown source</TabsTrigger>
          </TabsList>

          <TabsContent value="fields" className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Name" hint="Letters, digits, ':', '_' and '-'">
                <Input
                  value={draft.name}
                  onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
                  placeholder="my-skill"
                />
              </Field>
              <Field label="Description">
                <Input
                  value={draft.description}
                  onChange={e => setDraft(d => ({ ...d, description: e.target.value }))}
                  placeholder="One-line summary shown in the listing"
                />
              </Field>
            </div>

            <Field label="When to use" hint="Appended after description with ' - '.">
              <Textarea
                value={draft.whenToUse}
                onChange={e => setDraft(d => ({ ...d, whenToUse: e.target.value }))}
                placeholder="Triggers / use cases."
                rows={2}
              />
            </Field>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Argument hint">
                <Input
                  value={draft.argumentHint}
                  onChange={e => setDraft(d => ({ ...d, argumentHint: e.target.value }))}
                  placeholder="e.g. <company>"
                />
              </Field>
              <Field
                label="Argument names"
                hint={
                  <>
                    Refer in body via <code>$company</code>, etc.
                  </>
                }>
                <Input
                  value={draft.argumentNamesText}
                  onChange={e => setDraft(d => ({ ...d, argumentNamesText: e.target.value }))}
                  placeholder="space-separated, e.g. target focus"
                />
              </Field>
            </div>

            <Field
              label="Domains"
              hint={
                <>
                  Comma-separated. Empty → unconditional. Patterns: <code>example.com</code>, <code>*.example.com</code>
                  , <code>**.example.com</code>, <code>https://example.com/p/*</code>.
                </>
              }>
              <Input
                value={draft.domainsText}
                onChange={e => setDraft(d => ({ ...d, domainsText: e.target.value }))}
                placeholder="*.amazon.com, trendyol.com, https://github.com/*"
              />
            </Field>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Allowed tools" hint="Comma-separated; bypasses permission prompt for these tools.">
                <Input
                  value={draft.allowedToolsText}
                  onChange={e => setDraft(d => ({ ...d, allowedToolsText: e.target.value }))}
                  placeholder="navigate, find, run_js"
                />
              </Field>
              <Field label="Model override">
                <Input
                  value={draft.model}
                  onChange={e => setDraft(d => ({ ...d, model: e.target.value }))}
                  placeholder="e.g. sonnet, opus, claude-sonnet-4-6"
                />
              </Field>
            </div>

            <Field label="Body (markdown)" hint="Use $ARGUMENTS, $foo, ${doeverything_TAB_ID}, ${doeverything_SESSION_ID}.">
              <Textarea
                value={draft.body}
                onChange={e => setDraft(d => ({ ...d, body: e.target.value }))}
                rows={12}
                className="font-mono text-xs leading-relaxed"
              />
            </Field>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label="Version">
                <Input
                  value={draft.version}
                  onChange={e => setDraft(d => ({ ...d, version: e.target.value }))}
                  placeholder="optional"
                />
              </Field>
              <SwitchField
                label={`User-invocable (/${previewName})`}
                checked={draft.userInvocable}
                onChange={v => setDraft(d => ({ ...d, userInvocable: v }))}
              />
              <SwitchField
                label="Disable model invocation"
                checked={draft.disableModelInvocation}
                onChange={v => setDraft(d => ({ ...d, disableModelInvocation: v }))}
              />
            </div>
          </TabsContent>

          <TabsContent value="markdown" className="space-y-3">
            <Field
              label="Markdown source"
              hint="Edit raw frontmatter + body. Switching back to the Fields tab re-parses.">
              <Textarea
                value={markdown}
                onChange={e => setMarkdown(e.target.value)}
                rows={20}
                className="font-mono text-xs leading-relaxed"
              />
            </Field>
            <ParsedPreview draft={draft} />
          </TabsContent>
        </Tabs>

        {error && <p className="text-destructive text-sm">{error}</p>}

        <DialogFooter className="gap-2">
          <Button variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={saving} onClick={handleSave}>
            {saving ? 'Saving…' : skill ? 'Save changes' : 'Create skill'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
      {hint && <p className="text-muted-foreground text-[11px]">{hint}</p>}
    </div>
  );
}

function SwitchField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className={cn('border-border/70 flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm')}>
      <span>{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

function ParsedPreview({ draft }: { draft: DraftFields }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Live preview</CardTitle>
        <CardDescription>Frontmatter parsed from the markdown above.</CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
        <PreviewField label="Name" value={draft.name || '(empty)'} />
        <PreviewField label="Description" value={draft.description || '(empty)'} />
        <PreviewField label="Argument hint" value={draft.argumentHint || '(none)'} />
        <PreviewField label="Argument names" value={draft.argumentNamesText || '(none)'} />
        <PreviewField label="Domains" value={draft.domainsText || '(unconditional)'} />
        <PreviewField label="Allowed tools" value={draft.allowedToolsText || '(none)'} />
        <PreviewField label="Model" value={draft.model || '(default)'} />
        <PreviewField label="Version" value={draft.version || '(none)'} />
      </CardContent>
    </Card>
  );
}

function PreviewField({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-0.5">
      <Label className="text-[10px] uppercase tracking-wider">{label}</Label>
      <Input value={value} readOnly className="bg-muted/40 font-mono text-[11px]" />
    </div>
  );
}
