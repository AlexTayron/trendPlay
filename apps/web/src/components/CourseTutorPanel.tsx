'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  TutorContextSummary,
  TutorMessageItem,
  TutorStatusResponse,
} from '@devcore/shared';
import {
  clearTutorConversation,
  getTutorHistory,
  getTutorStatus,
  sendTutorMessage,
} from '../lib/api';

const QUICK_PROMPTS = [
  'Resuma os principais conceitos desta aula',
  'Explique com um exemplo prático de código',
  'Crie 3 perguntas de revisão sobre esta aula',
  'Como esta aula se conecta ao restante do curso?',
];

interface CourseTutorPanelProps {
  courseId: string;
  lessonId?: string | null;
  lessonTitle?: string | null;
  currentTimeSeconds?: number;
  onClose?: () => void;
}

/**
 * Renderização leve de Markdown (blocos de código ```, inline `code`, **negrito** e quebras de linha).
 */
function FormattedMessage({ content }: { content: string }) {
  const parts = content.split(/(```[\s\S]*?```)/g);

  return (
    <div className="space-y-2 text-xs sm:text-[13px] leading-relaxed break-words">
      {parts.map((part, idx) => {
        if (part.startsWith('```') && part.endsWith('```')) {
          const inner = part.slice(3, -3).replace(/^[a-zA-Z0-9_-]+\n/, '');
          return (
            <pre
              key={idx}
              className="p-3 rounded-lg bg-[#090d14] border border-outline-variant/25 overflow-x-auto font-mono text-[11px] text-sky-200 leading-relaxed"
            >
              <code>{inner}</code>
            </pre>
          );
        }

        const lines = part.split('\n');
        return (
          <div key={idx} className="space-y-1">
            {lines.map((line, lIdx) => {
              if (!line.trim()) return <div key={lIdx} className="h-1" />;
              const inlineTokens = line.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
              return (
                <p key={lIdx}>
                  {inlineTokens.map((tok, tIdx) => {
                    if (tok.startsWith('`') && tok.endsWith('`')) {
                      return (
                        <code
                          key={tIdx}
                          className="px-1.5 py-0.5 rounded bg-surface-container-lowest border border-outline-variant/25 font-mono text-[11px] text-secondary"
                        >
                          {tok.slice(1, -1)}
                        </code>
                      );
                    }
                    if (tok.startsWith('**') && tok.endsWith('**')) {
                      return (
                        <strong key={tIdx} className="font-semibold text-white">
                          {tok.slice(2, -2)}
                        </strong>
                      );
                    }
                    return <span key={tIdx}>{tok}</span>;
                  })}
                </p>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

export function CourseTutorPanel({
  courseId,
  lessonId,
  lessonTitle,
  currentTimeSeconds = 0,
  onClose,
}: CourseTutorPanelProps) {
  const [status, setStatus] = useState<TutorStatusResponse | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<TutorMessageItem[]>([]);
  const [contextSummary, setContextSummary] = useState<TutorContextSummary | null>(null);
  const [input, setInput] = useState('');
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const listEndRef = useRef<HTMLDivElement | null>(null);

  const loadTutorData = useCallback(async () => {
    setLoadingHistory(true);
    setError(null);
    try {
      const [st, hist] = await Promise.all([
        getTutorStatus().catch(() => null),
        getTutorHistory(courseId, lessonId || undefined),
      ]);
      if (st) setStatus(st);
      setConversationId(hist.conversationId);
      setMessages(hist.messages);
      setContextSummary(hist.contextSummary);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Não foi possível carregar o histórico do Tutor.',
      );
    } finally {
      setLoadingHistory(false);
    }
  }, [courseId, lessonId]);

  useEffect(() => {
    loadTutorData();
  }, [loadTutorData]);

  useEffect(() => {
    listEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sending]);

  const handleSend = async (textToSend?: string) => {
    const content = (textToSend ?? input).trim();
    if (!content || sending) return;

    setInput('');
    setError(null);
    setSending(true);

    const optimisticId = `temp-${Date.now()}`;
    const optimisticUserMsg: TutorMessageItem = {
      id: optimisticId,
      role: 'user',
      content,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimisticUserMsg]);

    try {
      const res = await sendTutorMessage(courseId, {
        lessonId: lessonId || undefined,
        message: content,
        currentTimeSeconds: Math.floor(currentTimeSeconds || 0),
      });
      setConversationId(res.conversationId);
      setContextSummary(res.contextSummary);
      setMessages((prev) => [
        ...prev.filter((m) => m.id !== optimisticId),
        res.userMessage,
        res.assistantMessage,
      ]);
    } catch (err) {
      setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
      setInput(content);
      setError(err instanceof Error ? err.message : 'Erro ao consultar o Tutor Gemini.');
    } finally {
      setSending(false);
    }
  };

  const handleClear = async () => {
    if (!conversationId) {
      setMessages([]);
      return;
    }
    await clearTutorConversation(conversationId).catch(() => undefined);
    setConversationId(null);
    setMessages([]);
  };

  return (
    <div className="flex flex-col h-full min-h-[440px]">
      {/* Cabeçalho do Tutor */}
      <div className="px-4 py-3 border-b border-outline-variant/20 bg-surface-container/60 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="material-symbols-outlined text-secondary text-[18px]">
              auto_awesome
            </span>
            <h3 className="text-xs sm:text-sm font-bold text-on-surface truncate">
              Tutor IA · Gemini
            </h3>
          </div>
          <p className="text-[10px] font-mono text-outline truncate mt-0.5">
            {contextSummary
              ? `${contextSummary.lessonsCount} aulas · ${contextSummary.notesCount} notas${
                  contextSummary.hasTranscript ? ' · transcrição ativa' : ''
                }`
              : 'Contexto específico deste curso'}
          </p>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {messages.length > 0 && (
            <button
              type="button"
              onClick={handleClear}
              title="Limpar conversa desta aula"
              className="p-1.5 rounded-lg text-outline hover:text-error hover:bg-surface-container-high transition-colors"
            >
              <span className="material-symbols-outlined text-[16px]">delete_sweep</span>
            </button>
          )}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              title="Fechar Tutor"
              className="p-1.5 rounded-lg text-outline hover:text-on-surface hover:bg-surface-container-high transition-colors"
            >
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
          )}
        </div>
      </div>

      {/* Aviso se GEMINI_API_KEY ainda não foi configurada */}
      {status && !status.configured && (
        <div className="mx-3 mt-3 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-100 text-xs space-y-1.5">
          <div className="font-semibold text-amber-300 flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[16px]">key</span>
            <span>Configure sua chave Gemini</span>
          </div>
          <p className="text-[11px] text-amber-200/90 leading-relaxed">
            Gere uma chave gratuita em{' '}
            <a
              href="https://aistudio.google.com/apikey"
              target="_blank"
              rel="noreferrer"
              className="underline text-secondary font-medium"
            >
              aistudio.google.com/apikey
            </a>{' '}
            e adicione <code className="font-mono bg-black/30 px-1 rounded">GEMINI_API_KEY</code> no{' '}
            <code className="font-mono">.env</code> / <code className="font-mono">.env.prod</code>.
          </p>
        </div>
      )}

      {error && (
        <div className="mx-3 mt-3 p-2.5 rounded-lg bg-error/10 border border-error/30 text-error text-xs">
          {error}
        </div>
      )}

      {/* Área de mensagens */}
      <div className="flex-1 overflow-y-auto px-3.5 py-3 space-y-3">
        {loadingHistory ? (
          <div className="h-40 flex items-center justify-center text-xs text-outline gap-2">
            <span className="material-symbols-outlined text-[18px] animate-spin text-secondary">
              progress_activity
            </span>
            <span>Carregando Tutor do curso...</span>
          </div>
        ) : messages.length === 0 ? (
          <div className="py-4 space-y-4">
            <div className="p-3.5 rounded-xl bg-surface-container/70 border border-outline-variant/20 space-y-1.5">
              <p className="text-xs font-semibold text-on-surface">
                Pergunte qualquer coisa sobre{' '}
                <span className="text-secondary">
                  {lessonTitle || contextSummary?.courseTitle || 'este curso'}
                </span>
              </p>
              <p className="text-[11px] text-outline leading-relaxed">
                O Tutor lê a ementa completa do curso, a aula e o minuto em que você está, suas
                anotações e transcrições/arquivos de apoio vinculados.
              </p>
            </div>

            <div className="space-y-1.5">
              <span className="text-[10px] font-mono uppercase tracking-wider text-outline">
                Sugestões rápidas
              </span>
              <div className="flex flex-col gap-1.5">
                {QUICK_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    disabled={sending || (status !== null && !status.configured)}
                    onClick={() => handleSend(prompt)}
                    className="text-left px-3 py-2 rounded-lg bg-surface-container hover:bg-surface-container-high border border-outline-variant/20 text-xs text-on-surface-variant hover:text-on-surface transition-colors disabled:opacity-45"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          messages.map((msg) => {
            const isUser = msg.role === 'user';
            return (
              <div
                key={msg.id}
                className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
              >
                <div
                  className={`max-w-[92%] rounded-2xl px-3.5 py-2.5 ${
                    isUser
                      ? 'bg-primary-container text-on-primary-container font-medium rounded-br-sm'
                      : 'bg-surface-container border border-outline-variant/25 text-on-surface rounded-bl-sm'
                  }`}
                >
                  {isUser ? (
                    <p className="text-xs sm:text-[13px] whitespace-pre-wrap break-words">
                      {msg.content}
                    </p>
                  ) : (
                    <FormattedMessage content={msg.content} />
                  )}
                </div>
              </div>
            );
          })
        )}

        {sending && (
          <div className="flex items-start">
            <div className="px-3.5 py-2.5 rounded-2xl rounded-bl-sm bg-surface-container border border-outline-variant/25 flex items-center gap-2 text-xs text-secondary">
              <span className="material-symbols-outlined text-[16px] animate-spin">
                progress_activity
              </span>
              <span>Gemini analisando o curso...</span>
            </div>
          </div>
        )}
        <div ref={listEndRef} />
      </div>

      {/* Input do Chat */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSend();
        }}
        className="p-3 border-t border-outline-variant/20 bg-surface-container/40 flex items-end gap-2"
      >
        <textarea
          rows={2}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder="Tire uma dúvida sobre esta aula..."
          disabled={sending}
          className="flex-1 resize-none rounded-xl bg-surface-container-lowest border border-outline-variant/30 px-3 py-2 text-xs sm:text-sm text-on-surface placeholder:text-outline focus:outline-none focus:border-secondary"
        />
        <button
          type="submit"
          disabled={sending || !input.trim()}
          title="Enviar pergunta"
          className="h-10 w-10 rounded-xl bg-secondary hover:bg-secondary-container text-surface flex items-center justify-center shrink-0 transition-colors disabled:opacity-40"
        >
          <span className="material-symbols-outlined text-[20px]">send</span>
        </button>
      </form>
    </div>
  );
}
