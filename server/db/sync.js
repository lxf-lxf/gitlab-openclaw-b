import { DataTypes } from 'sequelize'
import sequelize from './connection.js'
import './models/index.js'
import { dedupeWebhookConfigs } from '../services/project-webhook.js'

async function syncDatabase() {
  try {
    await sequelize.authenticate()
    console.log('Database connection established.')
    await sequelize.sync()

    const qi = sequelize.getQueryInterface()
    const table = await qi.describeTable('webhook_configs').catch(() => null)
    if (table && !table.gitlab_hook_id) {
      await qi.addColumn('webhook_configs', 'gitlab_hook_id', {
        type: DataTypes.INTEGER,
        allowNull: true
      })
      console.log('Added webhook_configs.gitlab_hook_id column.')
    }

    const eventsTable = await qi.describeTable('webhook_events').catch(() => null)
    if (eventsTable && !eventsTable.dispatch_note) {
      await qi.addColumn('webhook_events', 'dispatch_note', {
        type: DataTypes.STRING(500),
        allowNull: true
      })
      console.log('Added webhook_events.dispatch_note column.')
    }

    const sessionsTable = await qi.describeTable('agent_sessions').catch(() => null)
    if (sessionsTable && !sessionsTable.openclaw_session_key) {
      await qi.addColumn('agent_sessions', 'openclaw_session_key', {
        type: DataTypes.STRING(200),
        allowNull: true
      })
      console.log('Added agent_sessions.openclaw_session_key column.')
    }

    await dedupeWebhookConfigs()

    const indexes = await qi.showIndex('webhook_configs').catch(() => [])
    const hasProjectUnique = indexes.some(idx =>
      idx.unique && (idx.fields || []).some(f => (f.attribute || f.name) === 'project_id')
    )
    if (!hasProjectUnique) {
      await qi.addIndex('webhook_configs', ['project_id'], {
        unique: true,
        name: 'webhook_configs_project_id_unique'
      })
      console.log('Added unique index on webhook_configs.project_id.')
    }

    console.log('Database tables synced.')
  } catch (error) {
    console.error('Database sync failed:', error.message)
    throw error
  }
}

export default syncDatabase
