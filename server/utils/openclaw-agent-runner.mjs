#!/usr/bin/env node
/**
 * OpenClaw Agent 消息包装脚本
 *
 * 用法:
 *   node openclaw-agent-runner.mjs --message-file <path> -- <openclaw.mjs> <agent args...>
 *
 * 原理:
 *   1. 读取消息文件内容
 *   2. 替换 restArgs 中 --message 后面的占位符为实际消息
 *   3. 重建 process.argv = [node, openclaw.mjs, ...restArgs]
 *   4. import(openclaw.mjs) → OpenClaw 从 process.argv 解析，正常执行
 */
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'

const args = process.argv.slice(2)
const sepIdx = args.indexOf('--')

if (sepIdx < 0) {
  console.error('[openclaw-agent-runner] 用法: --message-file <path> -- <openclaw.mjs> <args...>')
  process.exit(1)
}

const wrapperArgs = args.slice(0, sepIdx)
const rest = args.slice(sepIdx + 1)

const fileIdx = wrapperArgs.indexOf('--message-file')
if (fileIdx < 0 || !wrapperArgs[fileIdx + 1]) {
  console.error('[openclaw-agent-runner] 缺少 --message-file 参数')
  process.exit(1)
}

const msgFile = wrapperArgs[fileIdx + 1]
let message
try {
  message = fs.readFileSync(msgFile, 'utf-8')
} catch (err) {
  console.error(`[openclaw-agent-runner] 读取消息文件失败: ${msgFile} - ${err.message}`)
  process.exit(1)
}

if (rest.length === 0) {
  console.error('[openclaw-agent-runner] 缺少 OpenClaw 入口点路径和参数')
  process.exit(1)
}

const msgFlagIdx = rest.indexOf('--message')
if (msgFlagIdx >= 0 && msgFlagIdx + 1 < rest.length) {
  rest[msgFlagIdx + 1] = message
} else {
  console.error('[openclaw-agent-runner] restArgs 中缺少 --message 参数')
  process.exit(1)
}

const mjsPath = rest[0]
process.argv = [process.argv[0], mjsPath, ...rest.slice(1)]

try {
  await import(pathToFileURL(mjsPath).href)
} catch (err) {
  console.error(`[openclaw-agent-runner] 加载 OpenClaw 入口点失败: ${err.message}`)
  process.exit(1)
}
