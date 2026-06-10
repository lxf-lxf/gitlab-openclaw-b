import { DataTypes } from 'sequelize'
import sequelize from '../connection.js'

const DailyReport = sequelize.define('daily_reports', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  report_date: { type: DataTypes.DATEONLY, allowNull: false },
  title: { type: DataTypes.STRING(200), defaultValue: '' },
  sections: { type: DataTypes.JSON, defaultValue: [] },
  summary: { type: DataTypes.TEXT, defaultValue: '' },
  sent: { type: DataTypes.TINYINT, defaultValue: 0 },
  sent_at: { type: DataTypes.DATE },
  created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
})

export default DailyReport
