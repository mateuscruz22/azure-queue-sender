/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Send, Sparkles, AlertCircle, CheckCircle2, Loader2, TriangleAlert, X, History, Boxes, Moon, Sun } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface QueueOption {
  id: string;
  label: string;
  queueName: string;
  environment: string;
}

interface EnvironmentGroup {
  id: string;
  label: string;
  badge: string;
  queues: QueueOption[];
}

const HISTORY_KEY = 'azure-queue-sender-history';
const THEME_KEY = 'azure-queue-sender-theme';
const MAX_HISTORY = 5;
const DEFAULT_ENVIRONMENT = 'development';
const ENVIRONMENT_ORDER = ['development', 'staging', 'production'];
const ENVIRONMENT_LABELS: Record<string, { label: string; badge: string }> = {
  development: { label: 'Development', badge: 'DEV' },
  staging: { label: 'Staging', badge: 'STG' },
  production: { label: 'Production', badge: 'PROD' },
};

function loadHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveToHistory(payload: string) {
  const history = loadHistory();
  const next = [payload, ...history.filter((h) => h !== payload)].slice(0, MAX_HISTORY);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
}

function loadTheme(): 'dark' | 'light' {
  try {
    return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

function formatBytes(str: string): string {
  const bytes = new Blob([str]).size;
  if (bytes === 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function normalizeEnvironment(env: string): string {
  return env?.trim().toLowerCase() || DEFAULT_ENVIRONMENT;
}

function environmentCopy(env: string): { label: string; badge: string } {
  if (ENVIRONMENT_LABELS[env]) return ENVIRONMENT_LABELS[env];
  const label = env
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
  return { label: label || 'Outros', badge: (env || 'OUT').slice(0, 4).toUpperCase() };
}

function buildEnvironmentGroups(queues: QueueOption[]): EnvironmentGroup[] {
  const buckets = new Map<string, QueueOption[]>();

  queues.forEach((queue) => {
    const env = normalizeEnvironment(queue.environment);
    buckets.set(env, [...(buckets.get(env) ?? []), queue]);
  });

  const customEnvironments = Array.from(buckets.keys())
    .filter((env) => !ENVIRONMENT_ORDER.includes(env))
    .sort();

  return [...ENVIRONMENT_ORDER, ...customEnvironments]
    .filter((env) => buckets.has(env))
    .map((env) => ({
      id: env,
      ...environmentCopy(env),
      queues: buckets.get(env) ?? [],
    }));
}

function pickInitialEnvironment(queues: QueueOption[]): string {
  const available = new Set(queues.map((queue) => normalizeEnvironment(queue.environment)));
  return ENVIRONMENT_ORDER.find((env) => available.has(env)) ?? Array.from(available)[0] ?? DEFAULT_ENVIRONMENT;
}

export default function App() {
  const [payload, setPayload] = useState('');
  const [queues, setQueues] = useState<QueueOption[]>([]);
  const [selectedQueueId, setSelectedQueueId] = useState('');
  const [activeEnvironment, setActiveEnvironment] = useState(DEFAULT_ENVIRONMENT);
  const [isBatch, setIsBatch] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isFetchingQueues, setIsFetchingQueues] = useState(true);
  const [showProductionModal, setShowProductionModal] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error' | null; message: string }>({
    type: null,
    message: '',
  });
  const [history, setHistory] = useState<string[]>(loadHistory);
  const [showHistory, setShowHistory] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light'>(loadTheme);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const historyRef = useRef<HTMLDivElement>(null);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const environmentGroups = useMemo(() => buildEnvironmentGroups(queues), [queues]);
  const activeQueues = useMemo(
    () => environmentGroups.find((group) => group.id === activeEnvironment)?.queues ?? [],
    [activeEnvironment, environmentGroups]
  );
  const selectedQueue = useMemo(() => queues.find((q) => q.id === selectedQueueId), [queues, selectedQueueId]);
  const isProduction = normalizeEnvironment(selectedQueue?.environment ?? '') === 'production';

  const jsonState = useMemo<'valid' | 'invalid' | 'empty'>(() => {
    if (!payload.trim()) return 'empty';
    try {
      JSON.parse(payload);
      return 'valid';
    } catch {
      return 'invalid';
    }
  }, [payload]);

  const batchCount = useMemo<number | null>(() => {
    if (!isBatch) return null;
    try {
      const parsed = JSON.parse(payload);
      if (Array.isArray(parsed)) return parsed.length;
      return null;
    } catch {
      return null;
    }
  }, [isBatch, payload]);

  const payloadSize = useMemo(() => formatBytes(payload), [payload]);
  const isDarkTheme = theme === 'dark';

  useEffect(() => {
    localStorage.setItem(THEME_KEY, theme);
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    if (status.type === 'success') {
      dismissTimerRef.current = setTimeout(() => setStatus({ type: null, message: '' }), 4000);
    }
    return () => {
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    };
  }, [status]);

  useEffect(() => {
    if (!showHistory) return;
    const handler = (e: MouseEvent) => {
      if (historyRef.current && !historyRef.current.contains(e.target as Node)) {
        setShowHistory(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showHistory]);

  useEffect(() => {
    fetchQueues();
  }, []);

  const fetchQueues = async () => {
    try {
      setIsFetchingQueues(true);
      const response = await fetch('/api/queues');
      if (response.ok) {
        const data = (await response.json()) as QueueOption[];
        const initialEnvironment = pickInitialEnvironment(data);
        const initialQueue = data.find((queue) => normalizeEnvironment(queue.environment) === initialEnvironment) ?? data[0];

        setQueues(data);
        setActiveEnvironment(initialEnvironment);
        setSelectedQueueId(initialQueue?.id ?? '');
      }
    } catch (error) {
      console.error('Failed to fetch queues:', error);
    } finally {
      setIsFetchingQueues(false);
    }
  };

  const handleEnvironmentChange = (environment: string) => {
    const nextQueue = queues.find((queue) => normalizeEnvironment(queue.environment) === environment);
    setActiveEnvironment(environment);
    setSelectedQueueId(nextQueue?.id ?? '');
  };

  const handleFormatJson = () => {
    try {
      const parsed = JSON.parse(payload);
      setPayload(JSON.stringify(parsed, null, 2));
      setStatus({ type: 'success', message: 'JSON formatado com sucesso.' });
    } catch {
      setStatus({ type: 'error', message: 'O conteúdo não é um JSON válido para formatar.' });
    }
  };

  const handleSend = async () => {
    if (isLoading) return;
    if (!payload.trim()) {
      setStatus({ type: 'error', message: 'Por favor, insira um payload.' });
      return;
    }
    if (!selectedQueueId) {
      setStatus({ type: 'error', message: 'Por favor, selecione uma fila.' });
      return;
    }
    if (isProduction) {
      setShowProductionModal(true);
      return;
    }
    await doSend();
  };

  const doSend = async () => {
    setIsLoading(true);
    setStatus({ type: null, message: '' });
    try {
      const response = await fetch('/api/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ queueId: selectedQueueId, payload: JSON.parse(payload), isBatch }),
      });
      const data = await response.json();
      if (response.ok) {
        setStatus({ type: 'success', message: data.message || 'Mensagem enviada com sucesso para a fila.' });
        saveToHistory(payload);
        setHistory(loadHistory());
      } else {
        setStatus({ type: 'error', message: `Erro ${response.status}: ${data.error}` });
      }
    } catch {
      setStatus({ type: 'error', message: 'Erro de conexão com o servidor.' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleTextareaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSend();
      return;
    }

    if (e.key === 'Tab') {
      e.preventDefault();
      const ta = e.currentTarget;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const next = payload.substring(0, start) + '  ' + payload.substring(end);
      setPayload(next);
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = start + 2;
      });
    }
  };

  const handleClearPayload = () => {
    setPayload('');
    textareaRef.current?.focus();
  };

  const handleSelectHistory = (item: string) => {
    setPayload(item);
    setShowHistory(false);
  };

  return (
    <>
      <AnimatePresence>
        {showProductionModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className={cn(
              'fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-6 backdrop-blur-sm',
              !isDarkTheme && 'theme-light'
            )}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 16 }}
              transition={{ type: 'spring', stiffness: 380, damping: 30 }}
              className="w-full max-w-md rounded-lg border border-red-500/30 bg-zinc-950 p-8 shadow-2xl shadow-black/40"
            >
              <div className="mb-6 flex items-start gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-red-500/10">
                  <TriangleAlert className="h-6 w-6 text-red-400" />
                </div>
                <div>
                  <h2 className="mb-1 text-lg font-bold text-zinc-50">Ação em Produção</h2>
                  <p className="text-sm leading-relaxed text-zinc-400">
                    Você está prestes a enviar uma mensagem para a fila de{' '}
                    <span className="font-semibold text-red-400">produção</span>
                    {selectedQueue ? ` "${selectedQueue.label}"` : ''}. Esta ação não pode ser desfeita.
                  </p>
                </div>
              </div>

              <div className="mb-6 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3">
                <p className="text-xs font-bold uppercase tracking-wider text-red-300">
                  Tem certeza que deseja continuar?
                </p>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setShowProductionModal(false)}
                  className="flex-1 rounded-lg border border-zinc-700 py-3.5 text-sm font-bold text-zinc-300 transition-all duration-200 hover:bg-zinc-900 active:scale-[0.98]"
                >
                  Cancelar
                </button>
                <button
                  onClick={async () => {
                    setShowProductionModal(false);
                    await doSend();
                  }}
                  className="flex-1 rounded-lg bg-red-600 py-3.5 text-sm font-bold text-white shadow-lg shadow-red-950/40 transition-all duration-200 hover:bg-red-500 active:scale-[0.98]"
                >
                  Confirmar e Enviar
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <div
        className={cn(
          'min-h-screen bg-[#090d14] font-sans text-zinc-100 selection:bg-cyan-400/20 selection:text-cyan-100',
          !isDarkTheme && 'theme-light'
        )}
      >
        <div className="mx-auto max-w-5xl px-5 py-10 sm:px-6 lg:py-12">
          <header className="mb-10 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <motion.div
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                className="mb-2 flex items-center gap-3"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-cyan-500 text-zinc-950 shadow-lg shadow-cyan-950/40">
                  <Send className="h-5 w-5" />
                </div>
                <h1 className="text-3xl font-bold tracking-tight text-zinc-50">Azure Queue Sender</h1>
              </motion.div>
              <p className="font-medium text-zinc-400">
                Escolha o ambiente, selecione a fila e envie payloads para o Azure Service Bus.
              </p>
            </div>

            <button
              type="button"
              onClick={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
              className="inline-flex h-10 w-fit items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950/70 px-3 text-sm font-bold text-zinc-300 transition-colors hover:bg-zinc-900 hover:text-zinc-50"
              aria-label={isDarkTheme ? 'Ativar modo claro' : 'Ativar modo escuro'}
              title={isDarkTheme ? 'Ativar modo claro' : 'Ativar modo escuro'}
            >
              {isDarkTheme ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              {isDarkTheme ? 'Claro' : 'Escuro'}
            </button>
          </header>

          <main className="grid gap-7">
            <section>
              <div className="mb-3 flex items-center justify-between gap-4">
                <label className="ml-1 block text-xs font-bold uppercase tracking-wider text-zinc-500">
                  Ambiente da fila
                </label>
                {selectedQueue && (
                  <span className="truncate text-xs font-medium text-zinc-500">
                    Selecionada: <span className="text-zinc-300">{selectedQueue.label}</span>
                  </span>
                )}
              </div>

              <div
                role="tablist"
                aria-label="Ambientes"
                className="mb-4 grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-2 rounded-lg border border-zinc-800 bg-zinc-950/70 p-1"
              >
                {isFetchingQueues ? (
                  ENVIRONMENT_ORDER.map((env) => (
                    <div key={env} className="h-12 animate-pulse rounded-md bg-zinc-900" />
                  ))
                ) : environmentGroups.length === 0 ? (
                  <div className="rounded-md px-4 py-3 text-sm font-medium text-zinc-500">
                    Nenhuma fila configurada
                  </div>
                ) : (
                  environmentGroups.map((group) => {
                    const active = group.id === activeEnvironment;
                    const production = group.id === 'production';

                    return (
                      <button
                        key={group.id}
                        role="tab"
                        aria-selected={active}
                        onClick={() => handleEnvironmentChange(group.id)}
                        disabled={isLoading}
                        className={cn(
                          'flex min-h-12 items-center justify-between gap-3 rounded-md px-4 py-3 text-left transition-all duration-200',
                          'disabled:cursor-not-allowed disabled:opacity-50',
                          active
                            ? production
                              ? 'bg-red-500/15 text-red-100 ring-1 ring-red-500/40'
                              : 'bg-cyan-500/15 text-cyan-100 ring-1 ring-cyan-400/30'
                            : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100'
                        )}
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          {production ? (
                            <TriangleAlert className="h-4 w-4 shrink-0" />
                          ) : (
                            <Boxes className="h-4 w-4 shrink-0" />
                          )}
                          <span className="truncate text-sm font-bold">{group.label}</span>
                        </span>
                        <span
                          className={cn(
                            'rounded px-2 py-0.5 text-[11px] font-bold',
                            active ? 'bg-black/20 text-current' : 'bg-zinc-800 text-zinc-500'
                          )}
                        >
                          {group.badge} · {group.queues.length}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>

              {!isFetchingQueues && activeQueues.length > 0 && (
                <div className="grid gap-3 md:grid-cols-2">
                  {activeQueues.map((queue) => {
                    const selected = queue.id === selectedQueueId;
                    const production = normalizeEnvironment(queue.environment) === 'production';

                    return (
                      <button
                        key={queue.id}
                        onClick={() => setSelectedQueueId(queue.id)}
                        disabled={isLoading}
                        className={cn(
                          'min-h-24 rounded-lg border px-4 py-3 text-left transition-all duration-200',
                          'disabled:cursor-not-allowed disabled:opacity-50',
                          selected
                            ? production
                              ? 'border-red-500/60 bg-red-500/10 shadow-lg shadow-red-950/20'
                              : 'border-cyan-400/50 bg-cyan-500/10 shadow-lg shadow-cyan-950/20'
                            : 'border-zinc-800 bg-zinc-950/50 hover:border-zinc-700 hover:bg-zinc-900/70'
                        )}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-bold text-zinc-100">{queue.label}</p>
                            <p className="mt-1 truncate font-mono text-xs text-zinc-500">{queue.queueName}</p>
                          </div>
                          {selected && (
                            <CheckCircle2
                              className={cn('h-5 w-5 shrink-0', production ? 'text-red-400' : 'text-cyan-300')}
                            />
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              <AnimatePresence>
                {isProduction && (
                  <motion.div
                    initial={{ opacity: 0, height: 0, marginTop: 0 }}
                    animate={{ opacity: 1, height: 'auto', marginTop: 10 }}
                    exit={{ opacity: 0, height: 0, marginTop: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-2.5 text-xs font-bold text-red-300">
                      <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
                      Fila de produção selecionada. Qualquer envio afeta o ambiente real.
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </section>

            <section>
              <div className="mb-3 ml-1 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
                  <label className="text-xs font-bold uppercase tracking-wider text-zinc-500">
                    Payload (Texto ou JSON)
                  </label>
                  <label className={cn('flex items-center gap-2 group', isLoading ? 'cursor-not-allowed opacity-50' : 'cursor-pointer')}>
                    <div className="relative flex items-center">
                      <input
                        type="checkbox"
                        checked={isBatch}
                        onChange={(e) => setIsBatch(e.target.checked)}
                        disabled={isLoading}
                        className="peer sr-only"
                      />
                      <div className="h-4 w-4 rounded border-2 border-zinc-600 bg-zinc-950 transition-all duration-200 peer-checked:border-cyan-400 peer-checked:bg-cyan-500" />
                      <CheckCircle2 className="absolute left-0.5 h-3 w-3 text-zinc-950 opacity-0 transition-opacity duration-200 peer-checked:opacity-100" />
                    </div>
                    <span className="text-xs font-bold uppercase tracking-wider text-zinc-500 transition-colors group-hover:text-cyan-300">
                      Enviar elementos do array individualmente
                    </span>
                  </label>
                </div>

                <div className="flex items-center gap-2">
                  {history.length > 0 && (
                    <div className="relative" ref={historyRef}>
                      <button
                        onClick={() => setShowHistory((v) => !v)}
                        disabled={isLoading}
                        className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-bold uppercase tracking-wider text-zinc-500 transition-colors hover:bg-cyan-400/10 hover:text-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <History className="h-3.5 w-3.5" />
                        Histórico
                      </button>
                      <AnimatePresence>
                        {showHistory && (
                          <motion.div
                            initial={{ opacity: 0, scale: 0.95, y: -4 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95, y: -4 }}
                            className="absolute right-0 top-full z-20 mt-1 w-80 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950 shadow-xl shadow-black/40"
                          >
                            <div className="border-b border-zinc-800 px-4 py-2.5">
                              <p className="text-xs font-bold uppercase tracking-wider text-zinc-500">Recentes</p>
                            </div>
                            {history.map((item, i) => (
                              <button
                                key={i}
                                onClick={() => handleSelectHistory(item)}
                                className="w-full border-b border-zinc-900 px-4 py-3 text-left transition-colors last:border-0 hover:bg-zinc-900"
                              >
                                <p className="truncate font-mono text-xs text-zinc-400">{item}</p>
                              </button>
                            ))}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  )}

                  <button
                    onClick={handleFormatJson}
                    disabled={isLoading || jsonState !== 'valid'}
                    className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-bold uppercase tracking-wider text-cyan-300 transition-colors hover:bg-cyan-400/10 hover:text-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    Beauty
                  </button>
                </div>
              </div>

              <AnimatePresence>
                {isBatch && batchCount !== null && (
                  <motion.div
                    initial={{ opacity: 0, height: 0, marginBottom: 0 }}
                    animate={{ opacity: 1, height: 'auto', marginBottom: 8 }}
                    exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="ml-1 flex items-center gap-2 rounded-lg border border-cyan-400/20 bg-cyan-400/10 px-4 py-2.5 text-xs font-bold text-cyan-200">
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                      {batchCount} {batchCount === 1 ? 'mensagem será enviada' : 'mensagens serão enviadas'} individualmente.
                    </div>
                  </motion.div>
                )}
                {isBatch && batchCount === null && payload.trim() && (
                  <motion.div
                    initial={{ opacity: 0, height: 0, marginBottom: 0 }}
                    animate={{ opacity: 1, height: 'auto', marginBottom: 8 }}
                    exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="ml-1 flex items-center gap-2 rounded-lg border border-amber-400/20 bg-amber-400/10 px-4 py-2.5 text-xs font-bold text-amber-200">
                      <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                      O payload deve ser um array JSON válido para o modo batch.
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="relative">
                <textarea
                  ref={textareaRef}
                  value={payload}
                  onChange={(e) => setPayload(e.target.value)}
                  onKeyDown={handleTextareaKeyDown}
                  disabled={isLoading}
                  placeholder='Cole seu payload aqui... Ex: {"message": "hello"}'
                  className={cn(
                    'h-80 w-full resize-none rounded-lg border bg-zinc-950 px-6 py-5 font-mono text-sm text-zinc-100 shadow-sm',
                    'placeholder:text-zinc-600 focus:outline-none focus:ring-2',
                    'transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-50',
                    jsonState === 'invalid'
                      ? 'border-red-500/50 focus:border-red-400 focus:ring-red-500/20'
                      : jsonState === 'valid'
                      ? 'border-emerald-500/50 focus:border-emerald-400 focus:ring-emerald-500/20'
                      : 'border-zinc-800 focus:border-cyan-400 focus:ring-cyan-400/20'
                  )}
                />
                {payload && !isLoading && (
                  <button
                    onClick={handleClearPayload}
                    className="absolute right-3 top-3 rounded-md p-1.5 text-zinc-500 transition-all hover:bg-zinc-900 hover:text-zinc-300"
                    title="Limpar payload"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>

              <div className="mt-2 flex items-center justify-between gap-3 px-1">
                <div>
                  {jsonState === 'valid' && (
                    <span className="flex items-center gap-1 text-xs font-medium text-emerald-300">
                      <CheckCircle2 className="h-3 w-3" /> JSON válido
                    </span>
                  )}
                  {jsonState === 'invalid' && (
                    <span className="flex items-center gap-1 text-xs font-medium text-red-300">
                      <AlertCircle className="h-3 w-3" /> JSON inválido
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  {payloadSize && <span className="text-xs font-medium text-zinc-500">{payloadSize}</span>}
                  <span className="text-xs font-medium text-zinc-600">Ctrl+Enter para enviar</span>
                </div>
              </div>
            </section>

            <section className="flex flex-col gap-4">
              <button
                onClick={handleSend}
                disabled={isLoading || !payload.trim() || !selectedQueueId}
                className={cn(
                  'flex w-full items-center justify-center gap-3 rounded-lg py-5 text-lg font-bold text-zinc-950 shadow-xl',
                  'transition-all duration-200 active:scale-[0.98]',
                  'disabled:cursor-not-allowed disabled:scale-100 disabled:opacity-50 disabled:shadow-none',
                  isProduction
                    ? 'bg-red-500 shadow-red-950/30 hover:bg-red-400'
                    : 'bg-cyan-400 shadow-cyan-950/30 hover:bg-cyan-300'
                )}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="h-6 w-6 animate-spin" />
                    Enviando...
                  </>
                ) : (
                  <>
                    <Send className="h-5 w-5" />
                    {isProduction ? 'Enviar para Produção' : 'Enviar para Fila'}
                  </>
                )}
              </button>

              <AnimatePresence mode="wait">
                {status.type && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className={cn(
                      'flex items-start gap-3 rounded-lg border p-4',
                      status.type === 'success'
                        ? 'border-cyan-400/20 bg-cyan-400/10 text-cyan-100'
                        : 'border-red-500/20 bg-red-500/10 text-red-100'
                    )}
                  >
                    {status.type === 'success' ? (
                      <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
                    ) : (
                      <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
                    )}
                    <p className="flex-1 text-sm font-medium leading-relaxed">{status.message}</p>
                    <button
                      onClick={() => setStatus({ type: null, message: '' })}
                      className="text-current opacity-40 transition-opacity hover:opacity-70"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </section>
          </main>
        </div>
      </div>
    </>
  );
}
