import { DataTypes } from 'sequelize'
import sequelize from '../connection.js'

const WebhookConfig = sequelize.define('webhook_configs', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  project_id: { type: DataTypes.INTEGER, allowNull: false, unique: true },
  gitlab_hook_id: { type: DataTypes.INTEGER },
  webhook_url: { type: DataTypes.STRING(500), allowNull: false },
  is_enabled: { type: DataTypes.TINYINT, defaultValue: 0 },
  secret_token: { type: DataTypes.STRING(255) },
  last_sync_at: { type: DataTypes.DATE },
  push_events: { type: DataTypes.TINYINT, defaultValue: 1 },
  issues_events: { type: DataTypes.TINYINT, defaultValue: 1 },
  merge_requests_events: { type: DataTypes.TINYINT, defaultValue: 1 },
  note_events: { type: DataTypes.TINYINT, defaultValue: 1 },
  tag_push_events: { type: DataTypes.TINYINT, defaultValue: 0 },
  pipeline_events: { type: DataTypes.TINYINT, defaultValue: 0 },
  wiki_page_events: { type: DataTypes.TINYINT, defaultValue: 0 },
  job_events: { type: DataTypes.TINYINT, defaultValue: 0 },
  deployment_events: { type: DataTypes.TINYINT, defaultValue: 0 },
  releases_events: { type: DataTypes.TINYINT, defaultValue: 0 }
})

export default WebhookConfig
