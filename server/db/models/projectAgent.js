import { DataTypes } from 'sequelize'
import sequelize from '../connection.js'

const ProjectAgent = sequelize.define('project_agents', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  project_id: { type: DataTypes.INTEGER, allowNull: false },
  template_id: { type: DataTypes.INTEGER, allowNull: false },
  is_active: { type: DataTypes.TINYINT, defaultValue: 1 },
  execute_order: { type: DataTypes.INTEGER, defaultValue: 0, comment: '执行优先级（小=先执行）' }
})

export default ProjectAgent
