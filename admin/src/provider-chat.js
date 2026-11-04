import http from 'node:http';
import https from 'node:https';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { allowedAddress } from './model-settings.js';
import { HttpError } from './store.js';

const errors = {
  400: '模型接口拒绝了请求，请检查模型 ID 和对话长度。',
  401: '模型接口认证失败，请在服务端检查 API 密钥。',
  402: '模型账户余额不足，请在服务商账户充值后重试。',
  403: '模型接口拒绝访问，请检查密钥权限。',
  404: '未找到模型或对话接口，请检查 Base URL 和模型 ID。',
  422: '模型接口参数无效，请检查模型 ID 和对话内容。',
  429: '模型服务请求过于频繁，请稍后重试。',
};
export class ProviderError extends HttpError {
  constructor(message, code = 'provider_error', usage = null) { super(502, message); this.code = code; this.usage = usage; }
}
export function parseUsage(value) {
  const valid = n => Number.isSafeInteger(n) && n >= 0 && n <= 1_000_000_000;
  if (!value || ![value.prompt_tokens, value.completion_tokens, value.total_tokens].every(valid) || value.total_tokens !== value.prompt_tokens + value.completion_tokens) return null;
  const cached = value.prompt_cache_hit_tokens ?? value.prompt_tokens_details?.cached_tokens;
  const reasoning = value.completion_tokens_details?.reasoning_tokens;
  return { promptTokens: value.prompt_tokens, completionTokens: value.completion_tokens, totalTokens: value.total_tokens,
    cachedTokens: valid(cached) && cached <= value.prompt_tokens ? cached : null,
    reasoningTokens: valid(reasoning) && reasoning <= value.completion_tokens ? reasoning : null };
}

// No redirects, raw provider errors, or credentials in diagnostics. DNS is pinned
// after validation, with the same address restrictions as the settings probe.
export async function completeChat(config, apiKey, messages, { resolver = lookup, maxTokens = 4096 } = {}) {
  const url = new URL(`${config.baseUrl}/chat/completions`);
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const input = { model: config.model, messages, stream: false, max_tokens: maxTokens };
  // DeepSeek enables thinking by default. The workbench requests direct answers;
  // never forward or persist reasoning_content from a provider response.
  if (hostname === 'api.deepseek.com') input.thinking = { type: 'disabled' };
  const payload = JSON.stringify(input);
  let request, expired = false, timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => { expired = true; request?.destroy(); reject(new ProviderError('模型回复超时。请稍后重试，或在服务端增加超时。', 'provider_timeout')); }, config.timeoutSeconds * 1000);
  });
  const operation = (async () => {
    const addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await resolver(hostname, { all: true });
    if (expired) throw new ProviderError('模型回复超时。', 'provider_timeout');
    const destination = addresses.find(item => item.family === 4 && allowedAddress(item.address, url.protocol)) || addresses.find(item => allowedAddress(item.address, url.protocol));
    if (!destination) throw new ProviderError('模型接口解析到不支持的网络地址，已停止请求。', 'unsafe_address');
    return new Promise((resolve, reject) => {
      const headers = { Accept: 'application/json', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), 'User-Agent': 'ZhiZuoTai-Server/1.2' };
      if (config.authMode === 'bearer') headers.Authorization = `Bearer ${apiKey}`;
      request = (url.protocol === 'https:' ? https : http).request(url, {
        method: 'POST', headers, agent: false, family: destination.family,
        lookup: (_host, options, callback) => options.all ? callback(null, [destination]) : callback(null, destination.address, destination.family),
      }, response => {
        if (response.statusCode !== 200) {
          response.destroy();
          const status = response.statusCode;
          reject(new ProviderError(errors[status] || (status >= 300 && status < 400 ? '模型接口返回重定向，密钥未转发，请在服务端填写最终接口地址。' : `模型服务返回 HTTP ${status}，请稍后重试。`), `provider_http_${status}`));
          return;
        }
        let size = 0; const chunks = [];
        response.on('data', chunk => {
          size += chunk.length;
          if (size > 2_000_000) { response.destroy(); reject(new ProviderError('模型响应过大，已停止读取。', 'response_too_large')); }
          else chunks.push(chunk);
        });
        response.on('error', () => reject(new ProviderError('模型连接中断，请稍后重试。', 'response_interrupted')));
        response.on('end', () => {
          let data;
          try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
          catch { reject(new ProviderError('模型接口返回了无效的 JSON。', 'invalid_response')); return; }
          const usage = parseUsage(data.usage), choice = data.choices?.[0], content = choice?.message?.content;
          if (typeof content !== 'string' || !content.trim() || content.length > 50_000 || (apiKey && content.includes(apiKey))) {
            reject(new ProviderError('模型接口未返回可显示的回复，请检查模型配置后重试。', 'invalid_response', usage)); return;
          }
          if (!['stop', 'length'].includes(choice.finish_reason)) { reject(new ProviderError('模型未正常完成回复，请稍后重试。', 'incomplete_response', usage)); return; }
          resolve({ content, model: config.model, finishReason: choice.finish_reason, usage });
        });
      });
      request.on('error', reject);
      request.end(payload);
    });
  })();
  try { return await Promise.race([operation, deadline]); }
  catch (error) {
    if (error instanceof ProviderError) throw error;
    if (['ENOTFOUND', 'EAI_AGAIN'].includes(error.code)) throw new ProviderError('无法解析模型接口域名，请检查网络与地址。', 'provider_dns');
    if (/CERT|TLS|SSL/.test(error.code || '')) throw new ProviderError('模型接口 HTTPS 证书验证失败。', 'provider_tls');
    throw new ProviderError('无法连接模型接口，请检查网络、地址与端口。', 'provider_unavailable');
  } finally { clearTimeout(timer); }
}
