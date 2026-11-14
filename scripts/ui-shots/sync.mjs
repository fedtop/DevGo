// 把 .output/ui-preview/docs 的截图按版本目录同步进文档仓。
//
// 用法：pnpm shots:sync
// 可选：--dest ../dev-go-docs/docs/public/shots  --version 0.2.3
// 产物布局：<dest>/{version}/{lang}/{theme}/{scene}.png
// 文档页面引用：/dev-go-docs/shots/{version}/{lang}/{theme}/{scene}.png

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '../..')

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1]
    : (process.env[name] ?? fallback)
}

const src = resolve(repo, arg('src', '.output/ui-preview/docs'))
const version = (
  arg('version', '') || JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version
).replace(/^v/, '')
const dest = resolve(repo, arg('dest', '../dev-go-docs/docs/public/shots'), version)

if (!existsSync(src)) {
  console.error(`没有可同步的截图：${src} 不存在，先跑 pnpm shots`)
  process.exit(1)
}

const langs = readdirSync(src).filter((d) => statSync(join(src, d)).isDirectory())
let count = 0
for (const lang of langs) {
  for (const theme of readdirSync(join(src, lang))) {
    const from = join(src, lang, theme)
    const to = join(dest, lang, theme)
    rmSync(to, { recursive: true, force: true })
    mkdirSync(to, { recursive: true })
    cpSync(from, to, { recursive: true })
    count += readdirSync(to).filter((f) => f.endsWith('.png')).length
    console.log(`${lang}/${theme} -> ${to}`)
  }
}
console.log(`v${version} 共同步 ${count} 张截图到 ${dest}`)
