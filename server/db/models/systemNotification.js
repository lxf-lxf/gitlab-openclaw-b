import { DataTypes } from 'sequelize'
import sequelize from '../connection.js'

const SystemNotification = sequelize.define('system_notifications', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  type: { type: DataTypes.STRING(20), defaultValue: 'info' }, // info / warning / error / success
  title: { type: DataTypes.STRING(200), allowNull: false },
  message: { type: DataTypes.TEXT, defaultValue: '' },
  link: { type: DataTypes.STRING(500) },
  actions: { type: DataTypes.JSON },
  actionable: { type: DataTypes.TINYINT, defaultValue: 0 },
  actioned: { type: DataTypes.STRING(20) },
  read: { type: DataTypes.TINYINT, defaultValue: 0 },
  reportData: { type: DataTypes.JSON },
  reportId: { type: DataTypes.INTEGER },
  created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
})

export default SystemNotification
