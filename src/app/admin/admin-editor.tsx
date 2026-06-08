'use client';

import {
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  FileText,
  GitBranch,
  KeyRound,
  Loader2,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  Trash2,
  XCircle,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

const OWNER = 'Maomaoyz66';
const REPO = 'polytron-one-docs';
const BRANCH = 'main';
const TOKEN_STORAGE_KEY = 'polytron-one-docs.github-token';

type GithubTreeItem = {
  path: string;
  mode: string;
  type: 'blob' | 'tree';
  sha: string;
  size?: number;
  url: string;
};

type GithubTreeResponse = {
  tree: GithubTreeItem[];
  truncated: boolean;
};

type GithubContentResponse = {
  content: string;
  encoding: string;
  html_url?: string;
  path: string;
  sha: string;
};

type GithubSaveResponse = {
  commit?: {
    html_url?: string;
    sha: string;
  };
  content?: {
    path: string;
    sha: string;
  };
};

type DocsFile = {
  module: string;
  path: string;
  sha: string;
  title: string;
  type: 'mdx' | 'json';
};

type Notice = {
  kind: 'idle' | 'success' | 'error' | 'info';
  message: string;
  url?: string;
};

function encodeRepoPath(path: string) {
  return path.split('/').map(encodeURIComponent).join('/');
}

function encodeBase64Utf8(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';

  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }

  return btoa(binary);
}

function decodeBase64Utf8(value: string) {
  const normalized = value.replace(/\s/g, '');
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new TextDecoder().decode(bytes);
}

function formatError(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error);
}

function getFileTitle(path: string) {
  const cleanPath = path
    .replace(/^content\/docs\//, '')
    .replace(/\/index\.mdx$/, '')
    .replace(/\.mdx$/, '')
    .replace(/meta\.json$/, 'meta');

  if (!cleanPath) return 'Overview';

  const name = cleanPath.split('/').at(-1) ?? cleanPath;
  return name
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function getFileModule(path: string) {
  const cleanPath = path.replace(/^content\/docs\//, '');
  const [moduleName] = cleanPath.split('/');

  if (!moduleName || moduleName === 'index.mdx' || moduleName === 'meta.json') {
    return 'root';
  }

  return moduleName.replace(/-/g, ' ');
}

function toDocsFile(item: GithubTreeItem): DocsFile {
  const type = item.path.endsWith('.mdx') ? 'mdx' : 'json';

  return {
    module: getFileModule(item.path),
    path: item.path,
    sha: item.sha,
    title: getFileTitle(item.path),
    type,
  };
}

function isDocsFile(item: GithubTreeItem) {
  return (
    item.type === 'blob' &&
    item.path.startsWith('content/docs/') &&
    (item.path.endsWith('.mdx') || item.path.endsWith('meta.json'))
  );
}

function getLiveDocsUrl(path: string) {
  if (!path.endsWith('.mdx')) return null;

  let slug = path.replace(/^content\/docs/, '').replace(/\.mdx$/, '');

  if (slug === '/index') slug = '';
  if (slug.endsWith('/index')) slug = slug.slice(0, -'/index'.length);

  return `https://polytron-one-docs.vercel.app/docs${slug}`;
}

async function githubRequest<T>(
  path: string,
  token: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/vnd.github+json');
  headers.set('Authorization', `Bearer ${token}`);
  headers.set('X-GitHub-Api-Version', '2022-11-28');

  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers,
  });

  if (!response.ok) {
    let message = response.statusText;

    try {
      const body = (await response.json()) as { message?: string };
      message = body.message ?? message;
    } catch {
      const body = await response.text();
      if (body) message = body;
    }

    throw new Error(`GitHub ${response.status}: ${message}`);
  }

  return (await response.json()) as T;
}

export function AdminEditor() {
  const [token, setToken] = useState('');
  const [rememberToken, setRememberToken] = useState(false);
  const [files, setFiles] = useState<DocsFile[]>([]);
  const [filter, setFilter] = useState('');
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [fileSha, setFileSha] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [loadingContent, setLoadingContent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<Notice>({
    kind: 'idle',
    message: '输入 GitHub Token 后连接仓库。',
  });

  useEffect(() => {
    const storedToken = window.localStorage.getItem(TOKEN_STORAGE_KEY);

    if (storedToken) {
      window.setTimeout(() => {
        setToken(storedToken);
        setRememberToken(true);
        setNotice({ kind: 'info', message: '已读取本机保存的 Token。' });
      }, 0);
    }
  }, []);

  const selectedFile = useMemo(
    () => files.find((file) => file.path === selectedPath) ?? null,
    [files, selectedPath],
  );

  const dirty = content !== originalContent;

  const filteredFiles = useMemo(() => {
    const query = filter.trim().toLowerCase();

    if (!query) return files;

    return files.filter((file) =>
      `${file.title} ${file.module} ${file.path}`.toLowerCase().includes(query),
    );
  }, [files, filter]);

  async function loadFile(path: string, tokenValue = token) {
    if (!tokenValue.trim()) {
      setNotice({ kind: 'error', message: '请先输入 GitHub Token。' });
      return;
    }

    setLoadingContent(true);
    setNotice({ kind: 'info', message: `正在读取 ${path}` });

    try {
      const response = await githubRequest<GithubContentResponse>(
        `/repos/${OWNER}/${REPO}/contents/${encodeRepoPath(path)}?ref=${BRANCH}`,
        tokenValue.trim(),
      );

      const nextContent = decodeBase64Utf8(response.content);

      setSelectedPath(path);
      setFileSha(response.sha);
      setContent(nextContent);
      setOriginalContent(nextContent);
      setNotice({ kind: 'success', message: '文件已载入。' });
    } catch (error) {
      setNotice({ kind: 'error', message: formatError(error) });
    } finally {
      setLoadingContent(false);
    }
  }

  async function loadFiles() {
    const tokenValue = token.trim();

    if (!tokenValue) {
      setNotice({ kind: 'error', message: '请先输入 GitHub Token。' });
      return;
    }

    if (dirty && !window.confirm('当前内容还没有保存，确定重新连接仓库吗？')) {
      return;
    }

    setLoadingFiles(true);
    setNotice({ kind: 'info', message: '正在连接 GitHub 仓库。' });

    try {
      if (rememberToken) {
        window.localStorage.setItem(TOKEN_STORAGE_KEY, tokenValue);
      } else {
        window.localStorage.removeItem(TOKEN_STORAGE_KEY);
      }

      const response = await githubRequest<GithubTreeResponse>(
        `/repos/${OWNER}/${REPO}/git/trees/${BRANCH}?recursive=1`,
        tokenValue,
      );

      const nextFiles = response.tree
        .filter(isDocsFile)
        .map(toDocsFile)
        .sort((left, right) => left.path.localeCompare(right.path));

      setFiles(nextFiles);
      setNotice({
        kind: response.truncated ? 'error' : 'success',
        message: response.truncated
          ? '仓库文件列表过大，GitHub 返回结果不完整。'
          : `已载入 ${nextFiles.length} 个文档文件。`,
      });

      if (nextFiles.length > 0) {
        await loadFile(nextFiles[0].path, tokenValue);
      }
    } catch (error) {
      setNotice({ kind: 'error', message: formatError(error) });
    } finally {
      setLoadingFiles(false);
    }
  }

  async function handleSelectFile(path: string) {
    if (path === selectedPath) return;

    if (dirty && !window.confirm('当前文件还没有保存，确定切换文件吗？')) {
      return;
    }

    await loadFile(path);
  }

  async function saveFile() {
    if (!selectedPath || !fileSha) {
      setNotice({ kind: 'error', message: '请先选择一个文件。' });
      return;
    }

    const tokenValue = token.trim();

    if (!tokenValue) {
      setNotice({ kind: 'error', message: '请先输入 GitHub Token。' });
      return;
    }

    if (!dirty) {
      setNotice({ kind: 'info', message: '当前文件没有新的改动。' });
      return;
    }

    setSaving(true);
    setNotice({ kind: 'info', message: '正在提交到 GitHub。' });

    try {
      const response = await githubRequest<GithubSaveResponse>(
        `/repos/${OWNER}/${REPO}/contents/${encodeRepoPath(selectedPath)}`,
        tokenValue,
        {
          method: 'PUT',
          body: JSON.stringify({
            branch: BRANCH,
            content: encodeBase64Utf8(content),
            message: `Update docs content: ${selectedPath}`,
            sha: fileSha,
          }),
        },
      );

      if (response.content?.sha) {
        setFileSha(response.content.sha);
        setFiles((currentFiles) =>
          currentFiles.map((file) =>
            file.path === selectedPath ? { ...file, sha: response.content?.sha ?? file.sha } : file,
          ),
        );
      }

      setOriginalContent(content);
      setNotice({
        kind: 'success',
        message: '已保存并提交，Vercel 会自动部署。',
        url: response.commit?.html_url,
      });
    } catch (error) {
      setNotice({ kind: 'error', message: formatError(error) });
    } finally {
      setSaving(false);
    }
  }

  function clearToken() {
    window.localStorage.removeItem(TOKEN_STORAGE_KEY);
    setToken('');
    setRememberToken(false);
    setFiles([]);
    setSelectedPath(null);
    setFileSha(null);
    setContent('');
    setOriginalContent('');
    setNotice({ kind: 'info', message: 'Token 已从本机清除。' });
  }

  const liveDocsUrl = selectedFile ? getLiveDocsUrl(selectedFile.path) : null;

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b bg-background/95">
        <div className="mx-auto flex h-16 max-w-[1600px] items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href="/docs"
              className="inline-flex size-9 items-center justify-center rounded-md border text-muted-foreground transition hover:bg-muted hover:text-foreground"
              title="返回文档"
            >
              <ArrowLeft className="size-4" />
            </Link>
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                POLYTRON ONE
              </p>
              <h1 className="truncate text-lg font-semibold">Docs Admin</h1>
            </div>
          </div>

          <div className="hidden items-center gap-2 text-sm text-muted-foreground sm:flex">
            <GitBranch className="size-4" />
            <span>
              {OWNER}/{REPO}
            </span>
          </div>
        </div>
      </header>

      <div className="mx-auto grid min-h-[calc(100vh-4rem)] max-w-[1600px] grid-cols-1 lg:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="border-b bg-muted/20 lg:border-b-0 lg:border-r">
          <div className="space-y-5 p-4 sm:p-6">
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold">GitHub 连接</h2>
                <span className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs text-muted-foreground">
                  <ShieldCheck className="size-3.5" />
                  本地 Token
                </span>
              </div>

              <label className="block text-xs font-medium text-muted-foreground" htmlFor="token">
                Token
              </label>
              <div className="flex gap-2">
                <div className="relative min-w-0 flex-1">
                  <KeyRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    id="token"
                    type="password"
                    value={token}
                    onChange={(event) => setToken(event.target.value)}
                    placeholder="github_pat_..."
                    className="h-10 w-full rounded-md border bg-background pl-9 pr-3 text-sm outline-none transition focus:border-foreground"
                  />
                </div>
                <button
                  type="button"
                  onClick={clearToken}
                  className="inline-flex size-10 items-center justify-center rounded-md border bg-background text-muted-foreground transition hover:bg-muted hover:text-foreground"
                  title="清除 Token"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>

              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  checked={rememberToken}
                  onChange={(event) => setRememberToken(event.target.checked)}
                  className="size-4 rounded border"
                />
                保存到本机浏览器
              </label>

              <button
                type="button"
                onClick={loadFiles}
                disabled={loadingFiles || !token.trim()}
                className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-foreground px-3 text-sm font-medium text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loadingFiles ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <RefreshCw className="size-4" />
                )}
                连接仓库
              </button>
            </section>

            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold">文档文件</h2>
                <span className="text-xs text-muted-foreground">{filteredFiles.length}</span>
              </div>

              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                  placeholder="搜索文件"
                  className="h-10 w-full rounded-md border bg-background pl-9 pr-3 text-sm outline-none transition focus:border-foreground"
                />
              </div>

              <div className="max-h-[calc(100vh-27rem)] min-h-64 overflow-y-auto rounded-md border bg-background">
                {filteredFiles.length === 0 ? (
                  <div className="flex h-64 items-center justify-center px-6 text-center text-sm text-muted-foreground">
                    连接后会显示 content/docs 文件。
                  </div>
                ) : (
                  <div className="divide-y">
                    {filteredFiles.map((file) => {
                      const active = file.path === selectedPath;

                      return (
                        <button
                          key={file.path}
                          type="button"
                          onClick={() => {
                            void handleSelectFile(file.path);
                          }}
                          className={[
                            'flex w-full items-start gap-3 px-3 py-3 text-left transition',
                            active ? 'bg-muted text-foreground' : 'hover:bg-muted/70',
                          ].join(' ')}
                        >
                          <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">{file.title}</span>
                            <span className="mt-1 block truncate text-xs capitalize text-muted-foreground">
                              {file.module} / {file.type}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </section>
          </div>
        </aside>

        <section className="flex min-w-0 flex-col">
          <div className="flex flex-col gap-3 border-b bg-background px-4 py-4 sm:px-6 xl:flex-row xl:items-center xl:justify-between">
            <div className="min-w-0">
              <p className="truncate text-xs text-muted-foreground">
                {selectedFile?.path ?? 'content/docs'}
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <h2 className="truncate text-xl font-semibold">
                  {selectedFile?.title ?? '选择一个文档文件'}
                </h2>
                {dirty ? (
                  <span className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
                    未保存
                  </span>
                ) : null}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {liveDocsUrl ? (
                <a
                  href={liveDocsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-md border px-3 text-sm font-medium transition hover:bg-muted"
                >
                  <ExternalLink className="size-4" />
                  查看页面
                </a>
              ) : null}
              <button
                type="button"
                onClick={saveFile}
                disabled={saving || loadingContent || !selectedFile || !dirty}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-foreground px-4 text-sm font-medium text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                保存提交
              </button>
            </div>
          </div>

          <div className="border-b px-4 py-3 sm:px-6">
            <div
              className={[
                'flex items-start gap-2 rounded-md border px-3 py-2 text-sm',
                notice.kind === 'success'
                  ? 'border-green-200 bg-green-50 text-green-900'
                  : notice.kind === 'error'
                    ? 'border-red-200 bg-red-50 text-red-900'
                    : 'bg-muted/40 text-muted-foreground',
              ].join(' ')}
            >
              {notice.kind === 'success' ? (
                <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
              ) : notice.kind === 'error' ? (
                <XCircle className="mt-0.5 size-4 shrink-0" />
              ) : (
                <GitBranch className="mt-0.5 size-4 shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <span>{notice.message}</span>
                {notice.url ? (
                  <a
                    href={notice.url}
                    target="_blank"
                    rel="noreferrer"
                    className="ml-2 inline-flex items-center gap-1 underline underline-offset-4"
                  >
                    commit
                    <ExternalLink className="size-3" />
                  </a>
                ) : null}
              </div>
            </div>
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-[minmax(0,1fr)_300px]">
            <div className="min-h-[60vh] min-w-0">
              <textarea
                value={content}
                onChange={(event) => setContent(event.target.value)}
                disabled={!selectedFile || loadingContent}
                spellCheck={false}
                className="h-full min-h-[60vh] w-full resize-none border-0 bg-background p-4 font-mono text-[13px] leading-6 outline-none disabled:cursor-not-allowed disabled:bg-muted/30 sm:p-6"
                placeholder="选择文件后在这里编辑 MDX 内容"
              />
            </div>

            <aside className="border-t bg-muted/20 xl:border-l xl:border-t-0">
              <div className="space-y-5 p-4 sm:p-6">
                <section className="space-y-2">
                  <h3 className="text-sm font-semibold">当前文件</h3>
                  <dl className="space-y-2 text-sm">
                    <div>
                      <dt className="text-xs text-muted-foreground">路径</dt>
                      <dd className="break-all">{selectedFile?.path ?? '-'}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">分组</dt>
                      <dd className="capitalize">{selectedFile?.module ?? '-'}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">状态</dt>
                      <dd className="inline-flex items-center gap-2">
                        <span
                          className={[
                            'inline-block size-2 rounded-full',
                            dirty ? 'bg-amber-500' : 'bg-green-500',
                          ].join(' ')}
                        />
                        {dirty ? '有改动' : '已同步'}
                      </dd>
                    </div>
                  </dl>
                </section>

                <section className="space-y-2">
                  <h3 className="text-sm font-semibold">发布</h3>
                  <div className="space-y-2 text-sm text-muted-foreground">
                    <p className="flex items-start gap-2">
                      <Save className="mt-0.5 size-4 shrink-0" />
                      保存会生成 GitHub commit。
                    </p>
                    <p className="flex items-start gap-2">
                      <RefreshCw className="mt-0.5 size-4 shrink-0" />
                      Vercel 会自动部署 main 分支。
                    </p>
                  </div>
                </section>
              </div>
            </aside>
          </div>
        </section>
      </div>
    </main>
  );
}
