#!/usr/bin/env node
/**
 * 清空数据库所有表并重新初始化种子数据
 * 用法: npm run db:reset
 */
import Redis from 'ioredis'
import sequelize from '../server/db/connection.js'
import '../server/db/models/index.js'
import { seedDefaults } from '../server/db/seed.js'
import config from '../server/config.js'

async function flushRedis() {
  const { host, port, password, keyPrefix } = config.redis
  if (!host) {
    console.log('→ Redis 未配置，跳过')
    return
  }
  const redis = new Redis({ host, port, password: password || undefined })
  try {
    const pattern = `${keyPrefix || 'bcenter:'}*`
    let cursor = '0'
    let deleted = 0
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 200)
      cursor = next
      if (keys.length) {
        await redis.del(...keys)
        deleted += keys.length
      }
    } while (cursor !== '0')
    console.log(`→ Redis 已清理 ${deleted} 个键 (${pattern})`)
  } catch (err) {
    console.warn(`→ Redis 清理跳过: ${err.message}`)
  } finally {
    redis.disconnect()
  }
}

try {
  console.log('\n⚠️  正在清空数据库并重新初始化...\n')

  await sequelize.authenticate()
  console.log('→ 数据库连接成功')

  await sequelize.query('SET FOREIGN_KEY_CHECKS = 0')
  await sequelize.drop()
  await sequelize.sync()
  await sequelize.query('SET FOREIGN_KEY_CHECKS = 1')
  console.log('→ 所有表已删除并重建')

  await seedDefaults()
  console.log('→ 默认配置与 Agent 模板已写入')

  await flushRedis()

  console.log('\n✅ 数据库重置完成\n')
  process.exit(0)
} catch (err) {
  console.error(`\n❌ 重置失败: ${err.message}`)
  process.exit(1)
}
