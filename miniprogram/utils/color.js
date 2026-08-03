// miniprogram/utils/color.js
/**
 * 颜色工具：sRGB → CIELAB、最近色匹配、按套装构建调色板。
 * 纯函数，可在 Node 中测试；小程序与测试共用。
 */
const colorsData = require('../data/colors.js')

const CACHE = {}

function srgbToLinear(c) {
  c /= 255
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

function rgbToLab(r, g, b) {
  const rl = srgbToLinear(r)
  const gl = srgbToLinear(g)
  const bl = srgbToLinear(b)
  const x = (rl * 0.4124564 + gl * 0.3575761 + bl * 0.1804375) * 100
  const y = (rl * 0.2126729 + gl * 0.7151522 + bl * 0.072175) * 100
  const z = (rl * 0.0193339 + gl * 0.119192 + bl * 0.9503041) * 100
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  const fx = f(x / 95.047)
  const fy = f(y / 100)
  const fz = f(z / 108.883)
  return {
    L: 116 * fy - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz)
  }
}

function labDistance(a, b) {
  const dL = a.L - b.L
  const da = a.a - b.a
  const db = a.b - b.b
  return Math.sqrt(dL * dL + da * da + db * db)
}

function buildPalette(setKey) {
  const key = String(setKey)
  if (CACHE[key]) return CACHE[key]
  const codes = colorsData.sets[key] || []
  const palette = codes.map((code) => {
    const c = colorsData.colors[code]
    return {
      code,
      hex: c.hex,
      rgb: c.rgb,
      lab: rgbToLab(c.rgb[0], c.rgb[1], c.rgb[2])
    }
  })
  CACHE[key] = palette
  return palette
}

function nearestColor(r, g, b, palette) {
  const lab = rgbToLab(r, g, b)
  let best = null
  let bestDist = Infinity
  for (const item of palette) {
    const d = labDistance(lab, item.lab)
    if (d < bestDist) {
      bestDist = d
      best = item
    }
  }
  return best
}

module.exports = { rgbToLab, labDistance, buildPalette, nearestColor }
