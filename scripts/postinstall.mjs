#!/usr/bin/env node
import { initEnvFiles, shouldSkipEnvInit } from './init-env.mjs'

if (!shouldSkipEnvInit()) {
  try {
    initEnvFiles({ quiet: true })
  } catch (err) {
    console.warn(
      '[gitlab-b-center] postinstall 初始化失败（可手动 npx b-center init）:',
      err?.message || err
    )
  }
}
