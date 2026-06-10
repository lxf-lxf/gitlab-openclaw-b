import { DataTypes } from 'sequelize'
import sequelize from '../connection.js'

const AgentTemplate = sequelize.define('agent_templates', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  name: { type: DataTypes.STRING(255), allowNull: false },
  description: { type: DataTypes.TEXT },
  trigger_mode: {
    type: DataTypes.ENUM('event', 'manual'),
    defaultValue: 'manual',
    comment: '触发方式: event=接收到 GitLab 事件自动触发, manual=由其他 Agent 在运行时调用'
  },
  agent_config: { type: DataTypes.JSON, comment: '含 instructions(指令)、tools(工具列表)、event_types(触发事件列表)' },
  workspace_path: { type: DataTypes.STRING(500), comment: 'OpenClaw Agent 工作空间路径，留空则从已注册 Agent 读取' },
  is_active: { type: DataTypes.TINYINT, defaultValue: 1 },
  deployed: { type: DataTypes.TINYINT, defaultValue: 0, comment: '是否已初始化到 OpenClaw' }
})

export default AgentTemplate
