import { DataTypes } from 'sequelize'
import sequelize from '../connection.js'

const AdminConfig = sequelize.define('admin_configs', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  config_key: { type: DataTypes.STRING(100), allowNull: false, unique: true },
  config_value: { type: DataTypes.TEXT },
  description: { type: DataTypes.STRING(500) },
  updated_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
})

export default AdminConfig
