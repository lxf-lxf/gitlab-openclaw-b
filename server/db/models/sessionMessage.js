import { DataTypes } from 'sequelize'
import sequelize from '../connection.js'

const SessionMessage = sequelize.define('session_messages', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  session_id: { type: DataTypes.INTEGER, allowNull: false },
  role: { type: DataTypes.ENUM('agent', 'user', 'system'), allowNull: false },
  agent_id: { type: DataTypes.INTEGER },
  content: { type: DataTypes.TEXT },
  metadata: { type: DataTypes.JSON },
  created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
})

export default SessionMessage
