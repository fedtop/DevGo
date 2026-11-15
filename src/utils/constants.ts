/** 应用级常量（编译期内联，作为公共配置的唯一来源） */
export const SHIP_NAME = 'DevGo'
export const SITE_URL = 'https://github.com/fedtop/DevGo'
export const DOCS_URL = 'https://fedtop.github.io/dev-go-docs/'

/** 文档站中英独立页树，按界面语言直达 */
export function getDocsUrl(locale: 'zh-CN' | 'en'): string {
  return locale === 'en' ? `${DOCS_URL}en/guide/` : `${DOCS_URL}guide/`
}

/** 主题色（用于 antd 主题与自定义样式） */
export const THEME_COLOR = '#4f46e5'
