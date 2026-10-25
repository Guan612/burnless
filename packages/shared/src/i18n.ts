import { zhCN } from './locales/zh-CN'

/**
 * i18n 脚手架（决策 #15）：键值文案表 + 类型安全 key + {var} 插值。
 * MVP 只填 zh-CN；locales 表加一项即为新语言，客户端启动时按偏好选 Locale。
 */
export const locales = { 'zh-CN': zhCN } as const

export type Locale = keyof typeof locales
export type MessageKey = keyof typeof zhCN

export type Translator = (key: MessageKey, vars?: Record<string, string | number>) => string

export function createT(locale: Locale): Translator {
  const table = locales[locale]
  return (key, vars) => {
    let text: string = table[key]
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        text = text.replaceAll(`{${k}}`, String(v))
      }
    }
    return text
  }
}
