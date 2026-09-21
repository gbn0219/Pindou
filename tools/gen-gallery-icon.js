#!/usr/bin/env node
/**
 * 一次性工具：生成图库 tab 图标（gallery.png / gallery-active.png）。
 * 规格 81×81 RGBA，与现有 tabbar 图标一致；纯 Node（zlib + PNG chunk），无依赖。
 * 运行：node tools/gen-gallery-icon.js
 */
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

const SIZE = 81
const OUT_DIR = path.join(__dirname, '..', 'miniprogram', 'images', 'tabbar')

function crc32(buf) {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

// 图标：圆角相框 + 右上小圆(太阳) + 两座山（简单拼图/照片图形）
function drawIcon(r, g, b, a) {
  const px = new Uint8Array(SIZE * SIZE * 4)
  const put = (x, y, pr, pg, pb, pa) => {
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return
    const i = (y * SIZE + x) * 4
    px[i] = pr; px[i + 1] = pg; px[i + 2] = pb; px[i + 3] = pa
  }
  const B = 3 // 描边宽
  const x0 = 10, y0 = 14, x1 = SIZE - 11, y1 = SIZE - 15 // 相框范围
  const inFrameBorder = (x, y) => {
    const inBox = x >= x0 && x <= x1 && y >= y0 && y <= y1
    const near = x >= x0 - 1 && x <= x1 + 1 && y >= y0 - 1 && y <= y1 + 1
    return inBox && (x <= x0 + B - 1 || x >= x1 - B + 1 || y <= y0 + B - 1 || y >= y1 - B + 1) && near
  }
  // 太阳（实心圆）
  const sx = x1 - 16, sy = y0 + 15, sr = 5
  // 山：两个三角形（左高右低），底边贴相框下边
  const inTri = (x, y, apexX, apexY, baseHalf, baseY) => {
    if (y < apexY || y > baseY) return false
    const t = (y - apexY) / (baseY - apexY)
    return Math.abs(x - apexX) <= baseHalf * t + 0.5
  }
  const inMountain = (x, y) =>
    inTri(x, y, 26, 44, 13, y1 - B) || inTri(x, y, 48, 47, 12, y1 - B)
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (inFrameBorder(x, y)) { put(x, y, r, g, b, a); continue }
      const dx = x - sx, dy = y - sy
      if (dx * dx + dy * dy <= sr * sr) { put(x, y, r, g, b, a); continue }
      if (inMountain(x, y)) { put(x, y, r, g, b, a); continue }
      put(x, y, 0, 0, 0, 0)
    }
  }
  return px
}

function writePng(file, px) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(SIZE, 0)
  ihdr.writeUInt32BE(SIZE, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1))
  for (let y = 0; y < SIZE; y++) {
    raw[y * (SIZE * 4 + 1)] = 0 // filter none
    Buffer.from(px.buffer, y * SIZE * 4, SIZE * 4).copy(raw, y * (SIZE * 4 + 1) + 1)
  }
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ])
  fs.writeFileSync(path.join(OUT_DIR, file), png)
  console.log('written', file, png.length, 'bytes')
}

writePng('gallery.png', drawIcon(0x7a, 0x81, 0x89, 0xff)) // 未选中：tabBar color
writePng('gallery-active.png', drawIcon(0x12, 0x17, 0x1b, 0xff)) // 选中：selectedColor
