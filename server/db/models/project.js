import { DataTypes } from 'sequelize'
import sequelize from '../connection.js'

const Project = sequelize.define('projects', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  gitlab_id: { type: DataTypes.INTEGER, allowNull: false, unique: true },
  name: { type: DataTypes.STRING(255), allowNull: false },
  path_with_namespace: { type: DataTypes.STRING(500) },
  web_url: { type: DataTypes.STRING(500) },
  visibility: { type: DataTypes.STRING(20), defaultValue: 'private' },
  is_active: { type: DataTypes.TINYINT, defaultValue: 1 }
})

export default Project
