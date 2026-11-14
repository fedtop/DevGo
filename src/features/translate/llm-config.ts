/**
 * AI 翻译（OpenAI 兼容 Chat Completions 接口）配置与常用服务预设。
 *
 * 预设只负责预填 Base URL / 模型名，用户可随意改写；任何兼容
 * `POST {baseUrl}/chat/completions` + SSE 流式输出的服务都能使用。
 */

import { t, type MessageKey } from '@/utils/i18n'

export interface LlmConfig {
  /** 预设 id（仅用于界面回显，不影响请求） */
  preset: string
  /** 接口地址，如 https://api.openai.com/v1（也可直接填到 /chat/completions） */
  baseUrl: string
  /** 模型名 / 推理接入点 id */
  model: string
  /** 追加到系统提示词末尾的自定义要求（术语表、语气等），可为空 */
  prompt: string
}

export interface LlmPreset {
  id: string
  label: string
  baseUrl: string
  model: string
  /** 常用模型（下拉兜底候选；服务支持 /models 时会合并实时列表） */
  models?: string[]
  /** 填写提示（在哪里拿 key、模型名含义等） */
  hint?: string
}

/** 预设原始定义：品牌名直接写 label；需要翻译的名称 / 提示写文案 key，读取时再取当前界面语言 */
interface LlmPresetDef extends Omit<LlmPreset, 'label' | 'hint'> {
  label?: string
  labelKey?: MessageKey
  hintKey?: MessageKey
}

const PRESET_DEFS: readonly LlmPresetDef[] = [
  {
    id: 'custom',
    labelKey: 'translate.presets.custom',
    baseUrl: '',
    model: '',
  },
  {
    id: 'zhipu',
    labelKey: 'translate.presets.zhipu',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4-flash',
    models: ['glm-4-flash', 'glm-4-air', 'glm-4-plus', 'glm-4.5-air', 'glm-4.5', 'glm-4.6'],
    hintKey: 'translate.presets.hint.zhipu',
  },
  {
    id: 'zhipu-coding',
    labelKey: 'translate.presets.zhipuCoding',
    baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
    model: 'glm-4.6',
    models: ['glm-4.6', 'glm-4.5', 'glm-4.5-air'],
    hintKey: 'translate.presets.hint.codingPlan',
  },
  {
    id: 'zai-coding',
    labelKey: 'translate.presets.zaiCoding',
    baseUrl: 'https://api.z.ai/api/coding/paas/v4',
    model: 'glm-4.6',
    models: ['glm-4.6', 'glm-4.5', 'glm-4.5-air'],
    hintKey: 'translate.presets.hint.codingPlan',
  },
  {
    id: 'kimi-coding',
    label: 'Kimi For Coding',
    baseUrl: 'https://api.kimi.com/coding/v1',
    model: 'kimi-for-coding',
    models: ['kimi-for-coding'],
    hintKey: 'translate.presets.hint.codingPlan',
  },
  {
    id: 'bailian-coding',
    labelKey: 'translate.presets.bailianCoding',
    baseUrl: 'https://coding.dashscope.aliyuncs.com/v1',
    model: 'qwen3-coder-plus',
    models: ['qwen3-coder-plus', 'qwen3-max'],
    hintKey: 'translate.presets.hint.codingPlan',
  },
  {
    id: 'ark-coding',
    labelKey: 'translate.presets.arkCoding',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/coding/v3',
    model: '',
    hintKey: 'translate.presets.hint.arkCoding',
  },
  {
    id: 'minimax',
    label: 'MiniMax',
    baseUrl: 'https://api.minimaxi.com/v1',
    model: 'MiniMax-M2',
    models: ['MiniMax-M2'],
  },
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-4.1-nano', 'gpt-4.1'],
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    models: ['deepseek-chat', 'deepseek-reasoner'],
  },
  {
    id: 'qwen',
    labelKey: 'translate.presets.qwen',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
    models: ['qwen-plus', 'qwen-turbo', 'qwen-max', 'qwen-mt-plus', 'qwen-mt-turbo'],
  },
  {
    id: 'doubao',
    labelKey: 'translate.presets.doubao',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    model: '',
    hintKey: 'translate.presets.hint.doubao',
  },
  {
    id: 'moonshot',
    label: 'Kimi（Moonshot）',
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'moonshot-v1-8k',
    models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
  },
  {
    id: 'siliconflow',
    label: 'SiliconFlow',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'Qwen/Qwen2.5-7B-Instruct',
    models: ['Qwen/Qwen2.5-7B-Instruct', 'Qwen/Qwen2.5-72B-Instruct', 'deepseek-ai/DeepSeek-V3'],
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'openai/gpt-4o-mini',
    models: ['openai/gpt-4o-mini', 'google/gemini-2.0-flash-001', 'deepseek/deepseek-chat'],
  },
  {
    id: 'ollama',
    labelKey: 'translate.presets.ollama',
    baseUrl: 'http://localhost:11434/v1',
    model: 'qwen2.5:7b',
    models: ['qwen2.5:7b', 'qwen2.5:14b', 'llama3.1:8b'],
    hintKey: 'translate.presets.hint.ollama',
  },
]

/** label / hint 用 getter 在读取时翻译（t() 不能在模块顶层求值） */
export const LLM_PRESETS: readonly LlmPreset[] = PRESET_DEFS.map(
  ({ label, labelKey, hintKey, ...rest }): LlmPreset => ({
    ...rest,
    get label() {
      return labelKey ? t(labelKey) : (label ?? rest.id)
    },
    get hint() {
      return hintKey ? t(hintKey) : undefined
    },
  }),
)

const DEFAULT_PRESET = LLM_PRESETS.find((preset) => preset.id === 'zhipu') ?? LLM_PRESETS[0]

export const DEFAULT_LLM_CONFIG: LlmConfig = {
  preset: DEFAULT_PRESET.id,
  baseUrl: DEFAULT_PRESET.baseUrl,
  model: DEFAULT_PRESET.model,
  prompt: '',
}

export function getLlmPreset(id: string): LlmPreset | undefined {
  return LLM_PRESETS.find((preset) => preset.id === id)
}

/** 按接口地址匹配预设（手动改地址后仍能识别出是哪家服务） */
export function findPresetByBaseUrl(baseUrl: string): LlmPreset | undefined {
  const base = resolveApiBaseUrl(baseUrl).toLowerCase()
  if (!base) return undefined
  return LLM_PRESETS.find(
    (preset) => preset.baseUrl && resolveApiBaseUrl(preset.baseUrl).toLowerCase() === base,
  )
}

/** 接口根地址（去掉尾部 `/` 与可能填写的 `/chat/completions`） */
export function resolveApiBaseUrl(baseUrl: string): string {
  return baseUrl
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/chat\/completions$/i, '')
}

/** 模型列表接口地址（OpenAI 兼容：GET {base}/models） */
export function resolveModelsUrl(baseUrl: string): string {
  return `${resolveApiBaseUrl(baseUrl)}/models`
}

/** 归一化接口地址：去掉尾部 `/`，未包含 `/chat/completions` 时自动补齐 */
export function resolveChatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  return /\/chat\/completions$/i.test(trimmed) ? trimmed : `${trimmed}/chat/completions`
}

/** 是否本地服务（如 Ollama）：本地服务通常不需要 API Key */
export function isLocalService(baseUrl: string): boolean {
  try {
    const { hostname } = new URL(baseUrl.trim())
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
  } catch {
    return false
  }
}

/** 是否需要填写 API Key 才能使用（非本地服务） */
export function requiresApiKey(baseUrl: string): boolean {
  return !isLocalService(baseUrl)
}

/** 配置是否已填写到可以发请求的程度（Key 允许为空，兼容本地服务） */
export function isLlmConfigReady(config: LlmConfig): boolean {
  return Boolean(config.baseUrl.trim() && config.model.trim())
}

export function isLlmConfig(value: unknown): value is LlmConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const config = value as Partial<LlmConfig>
  return (
    typeof config.preset === 'string' &&
    typeof config.baseUrl === 'string' &&
    typeof config.model === 'string' &&
    typeof config.prompt === 'string'
  )
}

/** 配置可以直接使用：地址、模型已填；非本地服务还需要 API Key */
export function isLlmUsable(config: LlmConfig, apiKey: string): boolean {
  return isLlmConfigReady(config) && (Boolean(apiKey.trim()) || !requiresApiKey(config.baseUrl))
}
