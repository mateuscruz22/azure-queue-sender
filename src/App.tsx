/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Send, Sparkles, AlertCircle, CheckCircle2, Loader2, ChevronDown, TriangleAlert, X, History } from 'lucide-react';
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

const HISTORY_KEY = 'azure-queue-sender-history';
const MAX_HISTORY = 5;

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

function formatBytes(str: string): string {
  const bytes = new Blob([str]).size;
  if (bytes === 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function envLabel(env: string): string {
  if (env === 'production') return ' [PROD]';
  if (env === 'staging') return ' [STG]';
  if (env === 'development') return ' [DEV]';
  return env ? ` [${env.toUpperCase()}]` : '';
}

export default function App() {
  const [payload, setPayload] = useState('');
  const [queues, setQueues] = useState<QueueOption[]>([]);
  const [selectedQueueId, setSelectedQueueId] = useState('');
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

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const historyRef = useRef<HTMLDivElement>(null);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Derived: selected queue + production flag
  const selectedQueue = useMemo(() => queues.find((q) => q.id === selectedQueueId), [queues, selectedQueueId]);
  const isProduction = selectedQueue?.environment === 'production';

  // Derived: real-time JSON validation
  const jsonState = useMemo<'valid' | 'invalid' | 'empty'>(() => {
    if (!payload.trim()) return 'empty';
    try {
      JSON.parse(payload);
      return 'valid';
    } catch {
      return 'invalid';
    }
  }, [payload]);

  // Derived: batch message count
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

  // Derived: payload size
  const payloadSize = useMemo(() => formatBytes(payload), [payload]);

  // Auto-dismiss success status after 4 s
  useEffect(() => {
    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    if (status.type === 'success') {
      dismissTimerRef.current = setTimeout(() => setStatus({ type: null, message: '' }), 4000);
    }
    return () => {
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    };
  }, [status]);

  // Close history dropdown on outside click
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
        const data = await response.json();
        setQueues(data);
        if (data.length > 0) setSelectedQueueId(data[0].id);
      }
    } catch (error) {
      console.error('Failed to fetch queues:', error);
    } finally {
      setIsFetchingQueues(false);
    }
  };

  const handleFormatJson = () => {
    try {
      const parsed = JSON.parse(payload);
      setPayload(JSON.stringify(parsed, null, 2));
      setStatus({ type: 'success', message: 'JSON formatado com sucesso!' });
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
        setStatus({ type: 'success', message: data.message || 'Mensagem enviada com sucesso para a fila!' });
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
    // Ctrl+Enter or Cmd+Enter → send
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSend();
      return;
    }
    // Tab → indent with 2 spaces
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
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm px-6"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 16 }}
              transition={{ type: 'spring', stiffness: 380, damping: 30 }}
              className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-8"
            >
              <div className="flex items-start gap-4 mb-6">
                <div className="w-12 h-12 rounded-xl bg-red-100 flex items-center justify-center shrink-0">
                  <TriangleAlert className="w-6 h-6 text-red-600" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-[#1A1A1A] mb-1">Ação em Produção</h2>
                  <p className="text-sm text-zinc-500 leading-relaxed">
                    Você está prestes a enviar uma mensagem para a fila de{' '}
                    <span className="font-semibold text-red-600">produção</span>
                    {selectedQueue ? ` "${selectedQueue.label}"` : ''}. Esta ação não pode ser desfeita.
                  </p>
                </div>
              </div>

              <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 mb-6">
                <p className="text-xs font-bold uppercase tracking-wider text-red-500">
                  Tem certeza que deseja continuar?
                </p>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setShowProductionModal(false)}
                  className="flex-1 rounded-xl py-3.5 font-bold text-sm border border-zinc-200 text-zinc-600 hover:bg-zinc-50 active:scale-[0.98] transition-all duration-200"
                >
                  Cancelar
                </button>
                <button
                  onClick={async () => {
                    setShowProductionModal(false);
                    await doSend();
                  }}
                  className="flex-1 rounded-xl py-3.5 font-bold text-sm bg-red-600 text-white shadow-lg shadow-red-600/20 hover:bg-red-700 active:scale-[0.98] transition-all duration-200"
                >
                  Confirmar e Enviar
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="min-h-screen bg-[#F5F5F5] text-[#1A1A1A] font-sans selection:bg-brand/10">
        <div className="max-w-4xl mx-auto px-6 py-12">
          {/* Header */}
          <header className="mb-12">
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center gap-3 mb-2"
            >
              <div className="w-10 h-10 bg-brand rounded-xl flex items-center justify-center shadow-lg shadow-brand/20">
                <Send className="text-white w-5 h-5" />
              </div>
              <h1 className="text-3xl font-bold tracking-tight">Azure Queue Sender</h1>
            </motion.div>
            <p className="text-zinc-500 font-medium">Envie payloads para suas filas do Azure Service Bus de forma simples.</p>
          </header>

          <main className="grid gap-8">
            {/* Queue Selection */}
            <section>
              <label className="block text-xs font-bold uppercase tracking-wider text-zinc-400 mb-3 ml-1">
                Selecione a Fila Destino
              </label>
              <div className="relative group">
                <select
                  value={selectedQueueId}
                  onChange={(e) => setSelectedQueueId(e.target.value)}
                  disabled={isFetchingQueues || isLoading}
                  className={cn(
                    'w-full appearance-none bg-white border rounded-2xl px-5 py-4 pr-12',
                    'focus:outline-none focus:ring-2 focus:border-brand',
                    'transition-all duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-sm',
                    'text-base font-medium',
                    isProduction
                      ? 'border-red-300 focus:ring-red-200 text-red-700'
                      : 'border-zinc-200 focus:ring-brand/20'
                  )}
                >
                  {isFetchingQueues ? (
                    <option>Carregando filas...</option>
                  ) : queues.length === 0 ? (
                    <option>Nenhuma fila configurada</option>
                  ) : (
                    queues.map((q) => (
                      <option key={q.id} value={q.id}>
                        {q.label} ({q.queueName}) {envLabel(q.environment)}
                      </option>
                    ))
                  )}
                </select>
                <div
                  className={cn(
                    'absolute right-5 top-1/2 -translate-y-1/2 pointer-events-none transition-colors',
                    isProduction ? 'text-red-400' : 'text-zinc-400 group-hover:text-brand'
                  )}
                >
                  <ChevronDown className="w-5 h-5" />
                </div>
              </div>

              {/* Production warning badge */}
              <AnimatePresence>
                {isProduction && (
                  <motion.div
                    initial={{ opacity: 0, height: 0, marginTop: 0 }}
                    animate={{ opacity: 1, height: 'auto', marginTop: 8 }}
                    exit={{ opacity: 0, height: 0, marginTop: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="flex items-center gap-2 text-xs font-bold text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-2.5">
                      <TriangleAlert className="w-3.5 h-3.5 shrink-0" />
                      Fila de produção selecionada — qualquer envio afeta o ambiente real.
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </section>

            {/* Payload Editor */}
            <section>
              <div className="flex items-center justify-between mb-3 ml-1">
                <div className="flex items-center gap-4">
                  <label className="text-xs font-bold uppercase tracking-wider text-zinc-400">
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
                      <div className="w-4 h-4 border-2 border-zinc-300 rounded bg-white peer-checked:bg-brand peer-checked:border-brand transition-all duration-200" />
                      <CheckCircle2 className="absolute w-3 h-3 text-white opacity-0 peer-checked:opacity-100 left-0.5 transition-opacity duration-200" />
                    </div>
                    <span className="text-xs font-bold uppercase tracking-wider text-zinc-400 group-hover:text-brand transition-colors">
                      Enviar elementos do array individualmente
                    </span>
                  </label>
                </div>

                <div className="flex items-center gap-2">
                  {/* Payload history dropdown */}
                  {history.length > 0 && (
                    <div className="relative" ref={historyRef}>
                      <button
                        onClick={() => setShowHistory((v) => !v)}
                        disabled={isLoading}
                        className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-zinc-400 hover:text-brand transition-colors px-2 py-1 rounded-lg hover:bg-brand/5 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <History className="w-3.5 h-3.5" />
                        Histórico
                      </button>
                      <AnimatePresence>
                        {showHistory && (
                          <motion.div
                            initial={{ opacity: 0, scale: 0.95, y: -4 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95, y: -4 }}
                            className="absolute right-0 top-full mt-1 z-20 bg-white border border-zinc-200 rounded-xl shadow-xl w-80 overflow-hidden"
                          >
                            <div className="px-4 py-2.5 border-b border-zinc-100">
                              <p className="text-xs font-bold uppercase tracking-wider text-zinc-400">Recentes</p>
                            </div>
                            {history.map((item, i) => (
                              <button
                                key={i}
                                onClick={() => handleSelectHistory(item)}
                                className="w-full text-left px-4 py-3 hover:bg-zinc-50 transition-colors border-b border-zinc-50 last:border-0"
                              >
                                <p className="text-xs font-mono text-zinc-600 truncate">{item}</p>
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
                    className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-brand hover:text-brand/80 transition-colors px-2 py-1 rounded-lg hover:bg-brand/5 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    Beauty
                  </button>
                </div>
              </div>

              {/* Batch info banner */}
              <AnimatePresence>
                {isBatch && batchCount !== null && (
                  <motion.div
                    initial={{ opacity: 0, height: 0, marginBottom: 0 }}
                    animate={{ opacity: 1, height: 'auto', marginBottom: 8 }}
                    exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="flex items-center gap-2 text-xs font-bold text-brand bg-brand/5 border border-brand/10 rounded-xl px-4 py-2.5 ml-1">
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
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
                    <div className="flex items-center gap-2 text-xs font-bold text-amber-600 bg-amber-50 border border-amber-100 rounded-xl px-4 py-2.5 ml-1">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
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
                    'w-full h-80 bg-white border rounded-2xl px-6 py-5 font-mono text-sm',
                    'focus:outline-none focus:ring-2',
                    'transition-all duration-200 resize-none shadow-sm placeholder:text-zinc-300',
                    'disabled:opacity-50 disabled:cursor-not-allowed',
                    jsonState === 'invalid'
                      ? 'border-red-300 focus:ring-red-200 focus:border-red-400'
                      : jsonState === 'valid'
                      ? 'border-green-300 focus:ring-green-200 focus:border-green-400'
                      : 'border-zinc-200 focus:ring-brand/20 focus:border-brand'
                  )}
                />
                {/* Clear button */}
                {payload && !isLoading && (
                  <button
                    onClick={handleClearPayload}
                    className="absolute top-3 right-3 p-1.5 text-zinc-300 hover:text-zinc-500 hover:bg-zinc-100 rounded-lg transition-all"
                    title="Limpar payload"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              {/* Footer: JSON status + size + shortcut hint */}
              <div className="flex items-center justify-between mt-2 px-1">
                <div>
                  {jsonState === 'valid' && (
                    <span className="flex items-center gap-1 text-xs font-medium text-green-600">
                      <CheckCircle2 className="w-3 h-3" /> JSON válido
                    </span>
                  )}
                  {jsonState === 'invalid' && (
                    <span className="flex items-center gap-1 text-xs font-medium text-red-500">
                      <AlertCircle className="w-3 h-3" /> JSON inválido
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  {payloadSize && (
                    <span className="text-xs text-zinc-400 font-medium">{payloadSize}</span>
                  )}
                  <span className="text-xs text-zinc-300 font-medium">Ctrl+Enter para enviar</span>
                </div>
              </div>
            </section>

            {/* Action Button */}
            <section className="flex flex-col gap-4">
              <button
                onClick={handleSend}
                disabled={isLoading || !payload.trim() || !selectedQueueId}
                className={cn(
                  'w-full text-white rounded-2xl py-5 font-bold text-lg shadow-xl',
                  'active:scale-[0.98] transition-all duration-200',
                  'disabled:opacity-50 disabled:shadow-none disabled:scale-100 disabled:cursor-not-allowed',
                  'flex items-center justify-center gap-3',
                  isProduction
                    ? 'bg-red-600 shadow-red-600/20 hover:bg-red-700'
                    : 'bg-brand shadow-brand/20 hover:bg-brand/90'
                )}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-6 h-6 animate-spin" />
                    Enviando...
                  </>
                ) : (
                  <>
                    <Send className="w-5 h-5" />
                    {isProduction ? 'Enviar para Produção' : 'Enviar para Fila'}
                  </>
                )}
              </button>

              {/* Status Messages */}
              <AnimatePresence mode="wait">
                {status.type && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className={cn(
                      'p-4 rounded-2xl flex items-start gap-3 border',
                      status.type === 'success'
                        ? 'bg-blue-50 border-blue-100 text-blue-800'
                        : 'bg-red-50 border-red-100 text-red-800'
                    )}
                  >
                    {status.type === 'success' ? (
                      <CheckCircle2 className="w-5 h-5 mt-0.5 shrink-0" />
                    ) : (
                      <AlertCircle className="w-5 h-5 mt-0.5 shrink-0" />
                    )}
                    <p className="text-sm font-medium leading-relaxed flex-1">{status.message}</p>
                    <button
                      onClick={() => setStatus({ type: null, message: '' })}
                      className="text-current opacity-40 hover:opacity-70 transition-opacity"
                    >
                      <X className="w-4 h-4" />
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
