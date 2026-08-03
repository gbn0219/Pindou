// scripts/build-colors.js
/**
 * 从 docs/拼豆标准色彩RGB与拼豆盘尺寸.md 生成 miniprogram/data/colors.json
 * 用法: node scripts/build-colors.js
 * RGB 以 docs 第 3 节主表为准；第 4 节套装表只提供色号成员关系。
 */
const fs = require('fs')
const path = require('path')

const DOC = path.join(__dirname, '..', 'docs', '拼豆标准色彩RGB与拼豆盘尺寸.md')
const OUT = path.join(__dirname, '..', 'miniprogram', 'data', 'colors.json')

const MAIN_ROW = /^\|\s*([A-HM]\d{1,2})\s*\|\s*`?(#[0-9A-Fa-f]{6})`?\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|$/
const SET_ROW = /^\|\s*([A-HM]\d{1,2})\s*\|\s*`?(#[0-9A-Fa-f]{6})`?\s*\|$/
const SET_HEAD = /^###\s*4\.(\d)\s*MARD\s*(\d+)\s*色/

const md = fs.readFileSync(DOC, 'utf8')
const lines = md.split(/\r?\n/)

const colors = {}
const sets = {}
let currentSet = null

for (const line of lines) {
  const head = line.match(SET_HEAD)
  if (head) {
    currentSet = head[2]
    sets[currentSet] = []
    continue
  }
  const main = line.match(MAIN_ROW)
  if (main) {
    colors[main[1]] = {
      code: main[1],
      hex: main[2].toUpperCase(),
      rgb: [Number(main[3]), Number(main[4]), Number(main[5])]
    }
    continue
  }
  const setRow = line.match(SET_ROW)
  if (setRow && currentSet && !sets[currentSet].includes(setRow[1])) {
    sets[currentSet].push(setRow[1])
  }
}

const assert = (cond, msg) => {
  if (!cond) throw new Error('色卡校验失败: ' + msg)
}

assert(Object.keys(colors).length === 221, '主表应有 221 色，实际 ' + Object.keys(colors).length)
assert(sets['48'] && sets['48'].length === 48, '48 套装应有 48 色')
assert(sets['72'] && sets['72'].length === 72, '72 套装应有 72 色')
assert(sets['144'] && sets['144'].length === 144, '144 套装应有 144 色')
assert(sets['221'] && sets['221'].length === 221, '221 套装应有 221 色')

for (const key of Object.keys(sets)) {
  for (const code of sets[key]) {
    assert(colors[code], '套装 ' + key + ' 含主表没有的色号 ' + code)
  }
}
assert(Object.keys(colors).every((c) => sets['221'].includes(c)), '第 4.4 节清单与主表色号应一致')

const subset = (a, b) => a.every((c) => b.includes(c))
assert(subset(sets['48'], sets['72']), '48 应 ⊆ 72')
assert(subset(sets['72'], sets['144']), '72 应 ⊆ 144')
assert(subset(sets['144'], sets['221']), '144 应 ⊆ 221')

fs.mkdirSync(path.dirname(OUT), { recursive: true })
const data = { sets, colors }
fs.writeFileSync(OUT, JSON.stringify(data, null, 2) + '\n', 'utf8')
console.log(
  'colors.json 已生成: ' +
    Object.keys(colors).length +
    ' 色, 套装 48/72/144/221 = ' +
    [sets['48'].length, sets['72'].length, sets['144'].length, sets['221'].length].join('/')
)
