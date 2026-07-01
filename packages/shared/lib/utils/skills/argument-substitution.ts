/**
 * Argument substitution for skill bodies.
 *
 *   $name         → named arg (from frontmatter `arguments`)
 *   $ARGUMENTS[N] → indexed arg
 *   $0, $1, ...   → indexed shorthand
 *   $ARGUMENTS    → full args string
 *
 * If no placeholder appears AND args is non-empty, "ARGUMENTS: <args>"
 * is appended to the body so the skill can still react to the input.
 *
 * `parseArguments` is a minimal shell-quote-style splitter (whitespace
 * with single/double-quoted spans). doeverything skills don't need pipes /
 * redirects / variable expansion, so a small parser is adequate.
 */

export function parseArguments(args: string): string[] {
  if (!args || !args.trim()) return [];
  const out: string[] = [];
  let buf = '';
  let quote: '"' | "'" | null = null;
  let escaped = false;
  for (let i = 0; i < args.length; i++) {
    const c = args[i]!;
    if (escaped) {
      buf += c;
      escaped = false;
      continue;
    }
    if (c === '\\' && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (c === quote) {
        quote = null;
        continue;
      }
      buf += c;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if (/\s/.test(c)) {
      if (buf.length > 0) {
        out.push(buf);
        buf = '';
      }
      continue;
    }
    buf += c;
  }
  if (buf.length > 0) out.push(buf);
  return out;
}

export function parseArgumentNames(argumentNames: string | string[] | undefined): string[] {
  if (!argumentNames) return [];
  const isValid = (n: string) => typeof n === 'string' && n.trim() !== '' && !/^\d+$/.test(n);
  if (Array.isArray(argumentNames)) return argumentNames.filter(isValid);
  if (typeof argumentNames === 'string') {
    return argumentNames.split(/\s+/).filter(isValid);
  }
  return [];
}

export function substituteArguments(
  content: string,
  args: string | undefined,
  appendIfNoPlaceholder = true,
  argumentNames: string[] = [],
): string {
  // Always run substitution, even when args is missing — otherwise placeholders
  // like `$target` leak as literal text into the model's context. Treating
  // missing args as the empty string replaces the placeholders cleanly.
  const argString: string = args ?? '';
  const parsedArgs = parseArguments(argString);
  const original = content;

  for (let i = 0; i < argumentNames.length; i++) {
    const name = argumentNames[i];
    if (!name) continue;
    content = content.replace(new RegExp(`\\$${escapeRegex(name)}(?![\\[\\w])`, 'g'), parsedArgs[i] ?? '');
  }

  content = content.replace(/\$ARGUMENTS\[(\d+)\]/g, (_, idx: string) => {
    const n = parseInt(idx, 10);
    return parsedArgs[n] ?? '';
  });

  content = content.replace(/\$(\d+)(?!\w)/g, (_, idx: string) => {
    const n = parseInt(idx, 10);
    return parsedArgs[n] ?? '';
  });

  content = content.replaceAll('$ARGUMENTS', argString);

  if (content === original && appendIfNoPlaceholder && argString) {
    content = content + `\n\nARGUMENTS: ${argString}`;
  }
  return content;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
