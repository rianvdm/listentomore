// ABOUTME: Wraps a ChatClient so each model call emits OpenTelemetry GenAI spans via Workers custom spans.
// ABOUTME: The Cloudflare Agents dashboard lists each AI task as an agent, with model, tokens, and safe payloads.

import type { AITask } from '@listentomore/config';
import type { ChatClient, ChatCompletionOptions, ChatCompletionResponse, ChatMessage } from './types';

/**
 * Tasks whose prompts and answers may be stored on spans. Their inputs are
 * public artist, album, and genre names. Everything else stays off because
 * the input is a visitor's own question or listening data (listenAi,
 * userInsights*), or the task is not a plain text answer.
 */
const RECORD_MESSAGES_FOR: ReadonlySet<AITask> = new Set<AITask>([
  'artistSummary',
  'albumDetail',
  'genreSummary',
  'artistSentence',
  'albumRecommendations',
]);

function textParts(content: string) {
  return [{ type: 'text', content }];
}

function inputMessagesJson(messages: ChatMessage[]): string {
  return JSON.stringify(
    messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role, parts: textParts(m.content) }))
  );
}

function systemInstructionsJson(messages: ChatMessage[]): string | undefined {
  const system = messages.filter((m) => m.role === 'system');
  if (system.length === 0) return undefined;
  return JSON.stringify(system.flatMap((m) => textParts(m.content)));
}

/**
 * Wrap a chat client so every chatCompletion call produces an
 * `invoke_agent {task}` span with a nested `chat {model}` span, using the
 * attribute names the Agents dashboard reads (gen_ai.agent.name, .id,
 * gen_ai.conversation.id on both spans).
 */
export function withAgentTracing(
  client: ChatClient,
  task: AITask,
  tracing: Tracing
): ChatClient {
  const recordMessages = RECORD_MESSAGES_FOR.has(task);

  return {
    chatCompletion(options: ChatCompletionOptions): Promise<ChatCompletionResponse> {
      const identity = {
        'gen_ai.agent.name': task,
        'gen_ai.agent.id': `listentomore-${task}`,
        // One-shot tasks have no session, so each call is its own conversation.
        'gen_ai.conversation.id': crypto.randomUUID(),
      };

      return tracing.enterSpan(`invoke_agent ${task}`, (agentSpan) => {
        agentSpan.setAttributes({ 'gen_ai.operation.name': 'invoke_agent', ...identity });

        return tracing.enterSpan(`chat ${options.model}`, async (chatSpan) => {
          chatSpan.setAttributes({
            'gen_ai.operation.name': 'chat',
            ...identity,
            'gen_ai.request.model': options.model,
            'gen_ai.request.max_tokens': options.maxTokens,
          });
          if (recordMessages) {
            chatSpan.setAttributes({
              'gen_ai.system_instructions': systemInstructionsJson(options.messages),
              'gen_ai.input.messages': inputMessagesJson(options.messages),
            });
          }

          try {
            const response = await client.chatCompletion(options);
            const meta = response.metadata;
            chatSpan.setAttributes({
              'gen_ai.provider.name': meta?.provider,
              'gen_ai.response.model': meta?.model,
              'gen_ai.usage.input_tokens': meta?.usage?.inputTokens ?? undefined,
              'gen_ai.usage.output_tokens': meta?.usage?.outputTokens ?? undefined,
              'listentomore.web_search_used': meta?.features?.webSearchUsed,
              'listentomore.web_search_requests': meta?.features?.webSearchRequests ?? undefined,
              'listentomore.truncated': meta?.truncated,
            });
            if (recordMessages) {
              chatSpan.setAttribute(
                'gen_ai.output.messages',
                JSON.stringify([{ role: 'assistant', parts: textParts(response.content) }])
              );
            }
            return response;
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            chatSpan.recordException({ name: error instanceof Error ? error.name : 'Error', message });
            chatSpan.setStatus({ code: 'error', message });
            throw error;
          }
        });
      });
    },
  };
}
