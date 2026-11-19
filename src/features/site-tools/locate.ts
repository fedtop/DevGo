/**
 * 元素定位：把步骤里的选择器解析成页面元素（执行器用），以及为元素生成多个候选选择器（录制器用）。
 *
 * 选择器语法（与 Chrome DevTools Recorder 一致，便于导入它的录制）：
 * - 普通 CSS 选择器；
 * - aria/名称：按无障碍名称匹配（aria-label、aria-labelledby、按钮 / 链接文字、输入框的 label、placeholder、title、alt）；
 * - text/文字：按可见文字匹配（优先完全相同，其次包含，取最内层的元素）；
 * - xpath/表达式；
 * - pierce/CSS：穿透 Shadow DOM 查找。
 */

const INTERACTIVE =
  'a[href], button, input, textarea, select, summary, label, [role=button], [role=link], [role=menuitem], [role=tab], [role=option], [role=checkbox], [role=radio], [role=switch], [role=combobox], [role=searchbox], [role=textbox], [contenteditable=""], [contenteditable=true], [tabindex]:not([tabindex="-1"]), [onclick]'

/** 看起来是框架自动生成的 class / id（带哈希、过长），不适合做选择器 */
const UNSTABLE =
  /\d{3,}|[a-z]+-[a-zA-Z0-9]{5,}$|^css-|^sc-|^_|__[a-zA-Z0-9]{5,}|^ng-|^v-|^jsx-|^notranslate$|^devgo-/

const normalize = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, ' ').trim()

export function isVisible(element: Element): boolean {
  if (!(element instanceof HTMLElement || element instanceof SVGElement)) return true
  if (element instanceof HTMLElement && element.hidden) return false
  const rect = element.getBoundingClientRect()
  if (rect.width < 1 || rect.height < 1) {
    // display: contents 的元素自身没有尺寸，看子元素
    return getComputedStyle(element).display === 'contents'
  }
  const style = getComputedStyle(element)
  return style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0'
}

/** 元素的无障碍名称（简化版，覆盖常见写法） */
export function accessibleName(element: Element): string {
  const label = element.getAttribute('aria-label')
  if (label) return normalize(label)
  const labelledBy = element.getAttribute('aria-labelledby')
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join(' ')
    if (normalize(text)) return normalize(text)
  }
  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement
  ) {
    // label 包住控件时，名称不含控件自身的文字（如下拉框的选项）
    const labelText = [...(element.labels ?? [])]
      .map((item) => {
        const copy = item.cloneNode(true) as HTMLElement
        copy.querySelectorAll('input, select, textarea').forEach((control) => control.remove())
        return copy.textContent
      })
      .join(' ')
    if (normalize(labelText)) return normalize(labelText)
    if (element instanceof HTMLInputElement && /^(submit|button|reset)$/.test(element.type)) {
      return normalize(element.value)
    }
    const placeholder = element.getAttribute('placeholder')
    if (placeholder) return normalize(placeholder)
  }
  if (element instanceof HTMLImageElement) return normalize(element.alt)
  const tag = element.tagName.toLowerCase()
  const role = element.getAttribute('role') ?? ''
  if (
    /^(a|button|summary|option|h[1-6]|label|legend|th|td|li)$/.test(tag) ||
    /^(button|link|menuitem|tab|option|checkbox|radio|switch|heading|cell)$/.test(role)
  ) {
    const text = element instanceof HTMLElement ? element.innerText : (element.textContent ?? '')
    if (normalize(text)) return normalize(text)
  }
  return normalize(element.getAttribute('title'))
}

/** 遍历文档及所有打开的 Shadow DOM */
function* allElements(root: Document | ShadowRoot = document): Generator<Element> {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const element = node as Element
    yield element
    if (element.shadowRoot) yield* allElements(element.shadowRoot)
  }
}

function queryCss(selector: string, root: ParentNode = document): Element[] {
  try {
    return [...root.querySelectorAll(selector)]
  } catch {
    throw new Error(`选择器不合法：${selector}`)
  }
}

function queryPierce(selector: string): Element[] {
  const found: Element[] = []
  const visit = (root: Document | ShadowRoot) => {
    found.push(...queryCss(selector, root))
    for (const element of root.querySelectorAll('*')) {
      if (element.shadowRoot) visit(element.shadowRoot)
    }
  }
  visit(document)
  return found
}

function queryXpath(expression: string): Element[] {
  try {
    const result = document.evaluate(
      expression,
      document,
      null,
      XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
      null,
    )
    const found: Element[] = []
    for (let index = 0; index < result.snapshotLength; index += 1) {
      const node = result.snapshotItem(index)
      if (node instanceof Element) found.push(node)
    }
    return found
  } catch {
    throw new Error(`XPath 不合法：${expression}`)
  }
}

function queryAria(name: string): Element[] {
  const wanted = normalize(name)
  const controls: Element[] = []
  const others: Element[] = []
  for (const element of allElements()) {
    // label 只是给控件提供名称，本身不是操作目标（和浏览器无障碍树一致）
    if (element instanceof HTMLLabelElement) continue
    if (!element.matches(INTERACTIVE) && !element.hasAttribute('aria-label')) continue
    if (accessibleName(element) !== wanted) continue
    const isControl =
      element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement ||
      element instanceof HTMLSelectElement ||
      element instanceof HTMLButtonElement
    ;(isControl ? controls : others).push(element)
  }
  return [...controls, ...others]
}

function queryText(text: string): Element[] {
  const wanted = normalize(text)
  const exact: Element[] = []
  const partial: Element[] = []
  for (const element of allElements()) {
    if (!(element instanceof HTMLElement) || /^(SCRIPT|STYLE|NOSCRIPT)$/.test(element.tagName)) {
      continue
    }
    const content = normalize(element.innerText)
    if (!content.includes(wanted)) continue
    // 只要最内层的匹配元素：子元素里还有包含同样文字的就跳过自己
    const childMatches = [...element.children].some(
      (child) => child instanceof HTMLElement && normalize(child.innerText).includes(wanted),
    )
    if (childMatches) continue
    ;(content === wanted ? exact : partial).push(element)
  }
  return exact.length ? exact : partial
}

/** 按一条选择器查找全部匹配元素 */
export function queryAllBySelector(selector: string): Element[] {
  const [, prefix, rest] = /^(aria|text|xpath|pierce)\/(.*)$/s.exec(selector) ?? []
  switch (prefix) {
    case 'aria':
      return queryAria(rest)
    case 'text':
      return queryText(rest)
    case 'xpath':
      return queryXpath(rest)
    case 'pierce':
      return queryPierce(rest)
    default:
      return queryCss(selector)
  }
}

/** 依次尝试候选选择器，返回第一个找到的可见元素（都不可见时退而求其次返回第一个找到的） */
export function locate(candidates: string[]): Element | null {
  let fallback: Element | null = null
  for (const selector of candidates) {
    const found = queryAllBySelector(selector)
    const visible = found.find(isVisible)
    if (visible) return visible
    fallback ??= found[0] ?? null
  }
  return fallback
}

/* -------------------------------- 生成选择器 -------------------------------- */

function isUnique(selector: string, element: Element): boolean {
  try {
    const found = document.querySelectorAll(selector)
    return found.length === 1 && found[0] === element
  } catch {
    return false
  }
}

function attrSelector(name: string, value: string): string {
  return `[${name}="${value.replace(/["\\]/g, '\\$&')}"]`
}

export function stableClasses(element: Element): string[] {
  return [...element.classList].filter((name) => !UNSTABLE.test(name)).slice(0, 2)
}

/** 单个元素自身能区分的选择器片段（不含祖先） */
export function ownSelector(element: Element): string {
  const tag = element.tagName.toLowerCase()
  if (element.id && !UNSTABLE.test(element.id)) return `#${CSS.escape(element.id)}`
  for (const name of ['data-testid', 'data-test', 'data-qa', 'name', 'aria-label', 'placeholder']) {
    const value = element.getAttribute(name)
    if (value && value.length < 60) return `${tag}${attrSelector(name, value)}`
  }
  const classes = stableClasses(element)
  return classes.length ? `${tag}.${classes.map((name) => CSS.escape(name)).join('.')}` : tag
}

/** 尽量短且唯一的 CSS 选择器：自身特征不够时向上拼接祖先，最后用 :nth-of-type 兜底 */
export function uniqueSelector(element: Element): string {
  let selector = ownSelector(element)
  if (isUnique(selector, element)) return selector
  let current: Element | null = element
  const parts: string[] = []
  for (let depth = 0; current && current !== document.documentElement && depth < 8; depth += 1) {
    let part = ownSelector(current)
    const parent: Element | null = current.parentElement
    if (parent && !part.startsWith('#')) {
      const tagName = current.tagName
      const sameTag = [...parent.children].filter((child) => child.tagName === tagName)
      if (sameTag.length > 1) part += `:nth-of-type(${sameTag.indexOf(current) + 1})`
    }
    parts.unshift(part)
    selector = parts.join(' > ')
    if (part.startsWith('#') || isUnique(selector, element)) return selector
    current = parent
  }
  return selector
}

/** 从文档根开始的绝对 XPath（最后的兜底） */
function xpathOf(element: Element): string {
  const parts: string[] = []
  for (let current: Element | null = element; current; current = current.parentElement) {
    const tag = current.tagName.toLowerCase()
    const parent: Element | null = current.parentElement
    if (!parent) {
      parts.unshift(tag)
      break
    }
    const tagName = current.tagName
    const sameTag = [...parent.children].filter((child) => child.tagName === tagName)
    parts.unshift(sameTag.length > 1 ? `${tag}[${sameTag.indexOf(current) + 1}]` : tag)
  }
  return `/${parts.join('/')}`
}

/**
 * 为录制的元素生成候选选择器：按稳定程度排序（无障碍名称、id / 属性、文字、CSS 路径、XPath），
 * 只保留当前能唯一定位到该元素的。
 */
export function selectorCandidates(element: Element): string[] {
  const candidates: string[] = []
  const add = (selector: string) => {
    if (!selector || candidates.includes(selector)) return
    try {
      const found = queryAllBySelector(selector)
      if (found.length === 1 && found[0] === element) candidates.push(selector)
    } catch {
      // 生成的选择器不合法时跳过
    }
  }

  const name = accessibleName(element)
  if (name && name.length <= 80) add(`aria/${name}`)
  const own = ownSelector(element)
  if (own.startsWith('#') || own.includes('[')) add(own)
  add(uniqueSelector(element))
  const text = element instanceof HTMLElement ? normalize(element.innerText) : ''
  if (text && text.length <= 40 && !(element instanceof HTMLInputElement)) add(`text/${text}`)
  candidates.push(`xpath/${xpathOf(element)}`)
  return candidates.slice(0, 5)
}

/** 点击落在图标、文字等子元素上时，录制它所属的可交互元素 */
export function interactiveTarget(element: Element): Element {
  return element.closest(INTERACTIVE) ?? element
}
