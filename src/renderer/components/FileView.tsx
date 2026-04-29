import React, { useEffect, useState } from 'react';
import { createHighlighter, type BundledLanguage, type Highlighter, type ThemedToken } from 'shiki';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import { FileText } from 'lucide-react';

// Languages we support inline. Listed up-front so the highlighter pre-loads
// them and we don't trigger dynamic chunk fetches at runtime — those break
// inside a packaged Electron app served from file:// + asar.
const PRELOADED_LANGS: BundledLanguage[] = [
  'typescript',
  'tsx',
  'javascript',
  'jsx',
  'json',
  'jsonc',
  'css',
  'scss',
  'less',
  'html',
  'markdown',
  'mdx',
  'yaml',
  'toml',
  'xml',
  'bash',
  'sql',
  'python',
  'ruby',
  'go',
  'rust',
  'java',
  'kotlin',
  'swift',
  'c',
  'cpp',
  'csharp',
  'php',
  'lua',
  'vue',
  'svelte',
];

let highlighterPromise: Promise<Highlighter> | null = null;

function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    // JS regex engine avoids the Oniguruma WebAssembly module, which fails to
    // load over file:// inside a packaged .asar.
    highlighterPromise = createHighlighter({
      themes: ['tokyo-night'],
      langs: PRELOADED_LANGS,
      engine: createJavaScriptRegexEngine(),
    });
  }
  return highlighterPromise;
}

const LANGUAGE_MAP: Record<string, string> = {
  ts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  jsx: 'jsx',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  swift: 'swift',
  css: 'css',
  scss: 'scss',
  less: 'less',
  html: 'html',
  json: 'json',
  jsonc: 'jsonc',
  yaml: 'yaml',
  yml: 'yaml',
  md: 'markdown',
  mdx: 'mdx',
  sql: 'sql',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  c: 'c',
  cpp: 'cpp',
  h: 'c',
  hpp: 'cpp',
  cs: 'csharp',
  php: 'php',
  lua: 'lua',
  toml: 'toml',
  xml: 'xml',
  vue: 'vue',
  svelte: 'svelte',
};

function getLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  return LANGUAGE_MAP[ext] ?? 'text';
}

interface FileViewProps {
  taskId: string | null;
  filePath: string;
}

interface RenderedFile {
  lines: ThemedToken[][];
  fg: string;
  bg: string;
}

export function FileView({ taskId, filePath }: FileViewProps) {
  const [rendered, setRendered] = useState<RenderedFile | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'too-large' | 'error'>('loading');
  const [error, setError] = useState<string>('');
  const [size, setSize] = useState(0);

  useEffect(() => {
    if (!taskId || !filePath) return;
    let cancelled = false;
    setState('loading');
    setError('');

    (async () => {
      try {
        const res = await window.electronAPI.readFile({ taskId, filePath });
        if (cancelled) return;
        if (!res.success || !res.data) {
          setError(res.error ?? 'Failed to read file');
          setState('error');
          return;
        }
        if (res.data.tooLarge) {
          setSize(res.data.size);
          setState('too-large');
          return;
        }

        const lang = getLanguage(filePath);
        const highlighter = await getHighlighter();
        const supported = PRELOADED_LANGS.includes(lang as BundledLanguage);
        const tokens = highlighter.codeToTokens(res.data.content, {
          lang: supported ? (lang as BundledLanguage) : 'text',
          theme: 'tokyo-night',
        });

        if (cancelled) return;
        setRendered({
          lines: tokens.tokens,
          fg: tokens.fg ?? '#c0caf5',
          bg: tokens.bg ?? '#1a1b26',
        });
        setState('ready');
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setState('error');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [taskId, filePath]);

  if (state === 'loading') {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex items-center gap-3">
          <div className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          <span className="text-[13px] text-muted-foreground/50">Loading file...</span>
        </div>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="flex items-center justify-center h-full px-6">
        <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
          <FileText size={14} strokeWidth={1.8} />
          <span>{error || 'Could not read file.'}</span>
        </div>
      </div>
    );
  }

  if (state === 'too-large') {
    return (
      <div className="flex items-center justify-center h-full px-6">
        <div className="text-[12px] text-muted-foreground text-center">
          File is {(size / (1024 * 1024)).toFixed(1)}MB — too large to render inline.
        </div>
      </div>
    );
  }

  if (!rendered) return null;

  const lineNumberWidth = String(rendered.lines.length).length;

  return (
    <div
      className="h-full w-full overflow-auto font-mono text-[13px] leading-[1.5]"
      style={{ background: rendered.bg, color: rendered.fg }}
    >
      <div className="py-3 pr-6">
        {rendered.lines.map((line, i) => (
          <div key={i} className="flex">
            <span
              className="select-none text-right pr-4 pl-4 flex-shrink-0 tabular-nums"
              style={{
                color: 'rgba(192, 202, 245, 0.35)',
                minWidth: `${lineNumberWidth + 4}ch`,
              }}
            >
              {i + 1}
            </span>
            <span className="whitespace-pre flex-1">
              {line.length === 0
                ? ' '
                : line.map((token, j) => (
                    <span key={j} style={{ color: token.color }}>
                      {token.content}
                    </span>
                  ))}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
