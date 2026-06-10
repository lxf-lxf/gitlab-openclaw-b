import { DataTypes } from 'sequelize'
import sequelize from '../connection.js'

const WebhookEvent = sequelize.define('webhook_events', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  project_id: { type: DataTypes.INTEGER, allowNull: false },
  event_type: { type: DataTypes.STRING(50), allowNull: false },
  event_action: { type: DataTypes.STRING(50) },
  source_id: { type: DataTypes.INTEGER },
  payload: { type: DataTypes.JSON },
  raw_headers: { type: DataTypes.JSON },
  received_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  status: { type: DataTypes.ENUM('pending', 'processing', 'completed', 'failed'), defaultValue: 'pending' },
  agent_handled: { type: DataTypes.TINYINT, defaultValue: 0 },
  dispatch_note: { type: DataTypes.STRING(500), comment: 'Agent 调度结果说明（未调度原因 / 已调度模板名）' }
})

export default WebhookEvent
