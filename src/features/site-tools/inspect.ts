/**
 * 给 AI 生成站点工具用的网页结构概览（在内容脚本里运行）：
 * 列出可交互元素（输入框、按钮、链接）和重复出现的列表，并给出尽量稳定的 CSS 选择器。
 */

const MAX_CONTROLS = 120
const MAX_LISTS = 10
const MAX_OUTPUT_CHARS = 16_000
const TEXT_PREVIEW = 60

/** 看起来是框架自动生成的 class / id（带哈希、过长），不适合做选择器 */
const UNSTABLE = /\d{3,}|[a-z]+-[a-zA-Z0-9]{5,}$|^css-|^sc-|^_|__[a-zA-Z0-9]{5,}/

function isVisible(element: Element): boolean {
  if (!(element instanceof HTMLElement)) return true
  if (element.hidden) return false
  const rect = element.getBoundingClientRect()
  if (rect.width < 2 || rect.height < 2) return false
  const style = getComputedStyle(element)
  return style.visibility !== 'hidden' && style.display !== 'none'
}

function isUnique(selector: string): boolean {
  try {
    return document.querySelectorAll(selector).length === 1
  } catch {
    return false
  }
}

function attrSelector(name: string, value: string): string {
  return `[${name}="${value.replace(/["\\]/g, '\\$&')}"]`
}

function stableClasses(element: Element): string[] {
  return [...element.classList].filter((name) => !UNSTABLE.test(name)).slice(0, 2)
}

/** 单个元素自身能区分的选择器片段（不含祖先） */
function ownSelector(element: Element): string {
  const tag = element.tagName.toLowerCase()
  if (element.id && !UNSTABLE.test(element.id)) return `#${CSS.escape(element.id)}`
  for (const name of ['data-testid', 'data-test', 'name', 'aria-label', 'placeholder', 'type']) {
    const value = element.getAttribute(name)
    if (value && value.length < 60) return `${tag}${attrSelector(name, value)}`
  }
  const classes = stableClasses(element)
  return classes.length ? `${tag}.${classes.map((name) => CSS.escape(name)).join('.')}` : tag
}

/** 尽量短且唯一的选择器：自身特征不够时向上拼接祖先，最后用 :nth-of-type 兜底 */
export function uniqueSelector(element: Element): string {
  let selector = ownSelector(element)
  if (isUnique(selector)) return selector
  let current: Element | null = element
  const parts: string[] = []
  for (let depth = 0; current && current !== document.documentElement && depth < 6; depth += 1) {
    let part = ownSelector(current)
    const parent: Element | null = current.parentElement
    if (parent) {
      const sameTag = [...parent.children].filter((child) => child.tagName === current!.tagName)
      if (sameTag.length > 1 && !part.startsWith('#')) {
        part += `:nth-of-type(${sameTag.indexOf(current) + 1})`
      }
    }
    parts.unshift(part)
    selector = parts.join(' > ')
    if (part.startsWith('#') || isUnique(selector)) return selector
    current = parent
  }
  return selector
}

function preview(text: string | null | undefined): string {
  const value = (text ?? '').replace(/\s+/g, ' ').trim()
  return value.length > TEXT_PREVIEW ? `${value.slice(0, TEXT_PREVIEW)}…` : value
}

function describeControl(element: Element): string {
  const tag = element.tagName.toLowerCase()
  const bits = [`selector=${JSON.stringify(uniqueSelector(element))}`]
  if (element instanceof HTMLInputElement) bits.push(`type=${element.type}`)
  for (const name of ['name', 'placeholder', 'aria-label']) {
    const value = element.getAttribute(name)
    if (value) bits.push(`${name}=${JSON.stringify(preview(value))}`)
  }
  const text = element instanceof HTMLElement ? preview(element.innerText) : ''
  if (text && tag !== 'select') bits.push(`text=${JSON.stringify(text)}`)
  if (element instanceof HTMLAnchorElement && element.href) {
    bits.push(`href=${JSON.stringify(element.href.slice(0, 120))}`)
  }
  const form = element.closest('form')
  if (form && tag !== 'form') bits.push(`form=${JSON.stringify(uniqueSelector(form))}`)
  return `[${tag}] ${bits.join(' ')}`
}

/** 重复出现的同构子元素（搜索结果、列表、表格行），给出能选中全部条目的选择器 */
function findLists(): string[] {
  const groups: { selector: string; count: number; sample: Element; score: number }[] = []
  const seen = new Set<string>()
  for (const parent of document.querySelectorAll('body *')) {
    if (parent.children.length < 3 || !isVisible(parent)) continue
    const bySignature = new Map<string, Element[]>()
    for (const child of parent.children) {
      const signature = `${child.tagName}.${stableClasses(child).join('.')}`
      bySignature.set(signature, [...(bySignature.get(signature) ?? []), child])
    }
    for (const items of bySignature.values()) {
      if (items.length < 3) continue
      const sample = items[0]
      const text = sample instanceof HTMLElement ? sample.innerText.trim() : ''
      if (text.length < 8) continue
      const tag = sample.tagName.toLowerCase()
      const classes = stableClasses(sample)
      const itemPart = classes.length
        ? `${tag}.${classes.map((name) => CSS.escape(name)).join('.')}`
        : tag
      const selector = `${uniqueSelector(parent)} > ${itemPart}`
      if (seen.has(selector)) continue
      seen.add(selector)
      groups.push({
        selector,
        count: items.length,
        sample,
        score: items.length * Math.min(text.length, 200),
      })
    }
  }
  return groups
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_LISTS)
    .map(({ selector, count, sample }) => {
      const link = sample.querySelector('a[href]')
      const linkHint = link ? ` 条目内链接=${JSON.stringify(ownSelector(link))}` : ''
      return `[list] selector=${JSON.stringify(selector)} 条目数=${count}${linkHint} 第一条=${JSON.stringify(preview((sample as HTMLElement).innerText))}`
    })
}

export function inspectPage(): string {
  const controls = [
    ...document.querySelectorAll(
      'input:not([type=hidden]), textarea, select, button, [role=button], [role=searchbox], [contenteditable=true], form, a[href]',
    ),
  ].filter(isVisible)

  // 链接通常很多，排在输入框和按钮之后，超出上限的部分省略
  const weight = (element: Element) => (element.tagName === 'A' ? 1 : 0)
  const sorted = controls.sort((a, b) => weight(a) - weight(b)).slice(0, MAX_CONTROLS)

  const lines = [
    `网址：${location.href}`,
    `标题：${document.title}`,
    '',
    '## 可交互元素',
    ...sorted.map(describeControl),
    controls.length > MAX_CONTROLS ? `……另有 ${controls.length - MAX_CONTROLS} 个元素省略` : '',
    '',
    '## 重复的列表（适合用 read + fields 读取）',
    ...findLists(),
  ]
  const text = lines.filter((line, index) => line || lines[index - 1]).join('\n')
  return text.length > MAX_OUTPUT_CHARS ? `${text.slice(0, MAX_OUTPUT_CHARS)}\n…（已截断）` : text
}
