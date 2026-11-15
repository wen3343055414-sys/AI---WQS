export const PROTOCOLS = Object.freeze({ openai: 'OpenAI 兼容', anthropic: 'Anthropic Messages', gemini: 'Gemini 原生' });
const valid = n => Number.isSafeInteger(n) && n >= 0 && n <= 1_000_000_000;

export function parseUsage(value) {
  if (!value || ![value.prompt_tokens, value.completion_tokens, value.total_tokens].every(valid) || value.total_tokens !== value.prompt_tokens + value.completion_tokens) return null;
  const cached = value.prompt_cache_hit_tokens ?? value.prompt_tokens_details?.cached_tokens;
  const reasoning = value.completion_tokens_details?.reasoning_tokens;
  return { promptTokens: value.prompt_tokens, completionTokens: value.completion_tokens, totalTokens: value.total_tokens,
    cachedTokens: valid(cached) && cached <= value.prompt_tokens ? cached : null,
    reasoningTokens: valid(reasoning) && reasoning <= value.completion_tokens ? reasoning : null };
}

export function credentialHeaders(config, key) {
  if (config.authMode === 'none') return {};
  if (config.protocol === 'anthropic') return { 'x-api-key': key, 'anthropic-version': '2023-06-01' };
  if (config.protocol === 'gemini') return { 'x-goog-api-key': key };
  return { Authorization: `Bearer ${key}` };
}

export function modelsUrl(config, cursor) {
  const url = new URL(`${config.baseUrl}/models`);
  if (config.protocol === 'gemini') { url.searchParams.set('pageSize', '100'); if (cursor) url.searchParams.set('pageToken', cursor); }
  if (config.protocol === 'anthropic') { url.searchParams.set('limit', '100'); if (cursor) url.searchParams.set('after_id', cursor); }
  return url;
}

export function parseModels(config, data, key) {
  if (!data || typeof data !== 'object') throw new Error('Invalid model directory');
  const list = config.protocol === 'gemini' ? data.models : data.data;
  if (!Array.isArray(list)) throw new Error('Invalid model directory');
  const models = [...new Set(list.filter(item => item && (config.protocol !== 'gemini' || !item.supportedGenerationMethods || Array.isArray(item.supportedGenerationMethods) && item.supportedGenerationMethods.includes('generateContent')))
    .map(item => config.protocol === 'gemini' ? typeof item.name === 'string' ? item.name.replace(/^models\//, '') : null : item.id)
    .filter(id => typeof id === 'string' && id.trim() && id.length <= 200 && !/[\x00-\x1f\x7f]/.test(id) && !(key && id.includes(key))))];
  const cursor = config.protocol === 'gemini' ? data.nextPageToken : config.protocol === 'anthropic' && data.has_more ? data.last_id : null;
  return { models, cursor: typeof cursor === 'string' && cursor.length <= 1000 ? cursor : null };
}

export function chatRequest(config, messages, maxTokens) {
  const system = messages.filter(m => m.role === 'system').map(m => m.content).join('\n');
  const conversation = messages.filter(m => m.role !== 'system');
  if (config.protocol === 'anthropic') return { url: new URL(`${config.baseUrl}/messages`), input: { model: config.model, system, messages: conversation, max_tokens: maxTokens, stream: false } };
  if (config.protocol === 'gemini') return { url: new URL(`${config.baseUrl}/models/${encodeURIComponent(config.model.replace(/^models\//, ''))}:generateContent`),
    input: { systemInstruction: { parts: [{ text: system }] }, contents: conversation.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })), generationConfig: { maxOutputTokens: maxTokens } } };
  const url = new URL(`${config.baseUrl}/chat/completions`);
  const input = { model: config.model, messages, stream: false, [['openai', 'minimax'].includes(config.preset) ? 'max_completion_tokens' : 'max_tokens']: maxTokens };
  if (config.preset === 'minimax') input.reasoning_split = true;
  if (url.hostname === 'api.deepseek.com') input.thinking = { type: 'disabled' };
  return { url, input };
}

export function parseReply(config, data) {
  if (!data || typeof data !== 'object') return { content: null, finishReason: null, usage: null };
  if (config.protocol === 'anthropic') {
    const u = data.usage;
    const prompt = u && valid(u.input_tokens) && valid(u.cache_creation_input_tokens ?? 0) && valid(u.cache_read_input_tokens ?? 0)
      ? u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) : null;
    const usage = prompt !== null && valid(u.output_tokens) ? parseUsage({ prompt_tokens: prompt, completion_tokens: u.output_tokens, total_tokens: prompt + u.output_tokens,
      prompt_tokens_details: { cached_tokens: u.cache_read_input_tokens }, completion_tokens_details: { reasoning_tokens: u.output_tokens_details?.thinking_tokens } }) : null;
    return { content: Array.isArray(data.content) ? data.content.filter(b => b?.type === 'text' && typeof b.text === 'string').map(b => b.text).join('') : null,
      finishReason: ({ end_turn: 'stop', stop_sequence: 'stop', max_tokens: 'length' })[data.stop_reason], usage };
  }
  if (config.protocol === 'gemini') {
    const u = data.usageMetadata, c = data.candidates?.[0];
    const output = u && valid(u.candidatesTokenCount) && valid(u.thoughtsTokenCount ?? 0) ? u.candidatesTokenCount + (u.thoughtsTokenCount ?? 0) : null;
    const usage = output !== null ? parseUsage({ prompt_tokens: u.promptTokenCount, completion_tokens: output, total_tokens: u.totalTokenCount,
      prompt_tokens_details: { cached_tokens: u.cachedContentTokenCount }, completion_tokens_details: { reasoning_tokens: u.thoughtsTokenCount } }) : null;
    return { content: Array.isArray(c?.content?.parts) ? c.content.parts.filter(b => b && !b.thought && typeof b.text === 'string').map(b => b.text).join('') : null,
      finishReason: ({ STOP: 'stop', MAX_TOKENS: 'length' })[c?.finishReason], usage };
  }
  return { content: data.choices?.[0]?.message?.content, finishReason: data.choices?.[0]?.finish_reason, usage: parseUsage(data.usage) };
}
