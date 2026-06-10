import { DataTypes } from 'sequelize'
import sequelize from '../connection.js'

const AgentSession = sequelize.define('agent_sessions', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  event_id: { type: DataTypes.INTEGER },
  project_id: { type: DataTypes.INTEGER },
  agent_name: { type: DataTypes.STRING(100), comment: 'OpenClaw agent 名称: webhook / supervisor' },
  template_id: { type: DataTypes.INTEGER, comment: '关联的 AgentTemplate ID' },
  session_type: { type: DataTypes.ENUM('event', 'manual'), defaultValue: 'event' },
  status: { type: DataTypes.ENUM('pending', 'active', 'completed', 'failed'), defaultValue: 'pending' },
  started_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  finished_at: { type: DataTypes.DATE },
  log_file: { type: DataTypes.STRING(500), comment: 'Agent 执行日志文件路径' },
  openclaw_session_id: { type: DataTypes.STRING(100), comment: 'OpenClaw 真实会话 ID' },
  openclaw_session_file: { type: DataTypes.STRING(500), comment: 'OpenClaw 会话 JSONL 文件路径' },
  fail_reason: { type: DataTypes.TEXT, comment: '失败原因' }
})

export default AgentSession
