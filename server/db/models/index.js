import Project from './project.js'
import WebhookConfig from './webhookConfig.js'
import WebhookEvent from './webhookEvent.js'
import AgentSession from './agentSession.js'
import SessionMessage from './sessionMessage.js'
import AgentTemplate from './agentTemplate.js'
import ProjectAgent from './projectAgent.js'
import AdminConfig from './adminConfig.js'
import SystemNotification from './systemNotification.js'
import DailyReport from './dailyReport.js'

// Project → WebhookConfig
Project.hasOne(WebhookConfig, { foreignKey: 'project_id', onDelete: 'CASCADE' })
WebhookConfig.belongsTo(Project, { foreignKey: 'project_id' })

// Project → WebhookEvent
Project.hasMany(WebhookEvent, { foreignKey: 'project_id', onDelete: 'CASCADE' })
WebhookEvent.belongsTo(Project, { foreignKey: 'project_id' })

// Project ↔ AgentTemplate (through ProjectAgent)
Project.belongsToMany(AgentTemplate, { through: ProjectAgent, foreignKey: 'project_id', otherKey: 'template_id' })
AgentTemplate.belongsToMany(Project, { through: ProjectAgent, foreignKey: 'template_id', otherKey: 'project_id' })
Project.hasMany(ProjectAgent, { foreignKey: 'project_id', onDelete: 'CASCADE' })
ProjectAgent.belongsTo(Project, { foreignKey: 'project_id' })
ProjectAgent.belongsTo(AgentTemplate, { foreignKey: 'template_id' })

// Session associations
AgentSession.belongsTo(WebhookEvent, { foreignKey: 'event_id' })
WebhookEvent.hasMany(AgentSession, { foreignKey: 'event_id', onDelete: 'CASCADE' })
AgentSession.belongsTo(Project, { foreignKey: 'project_id' })

// Message associations
AgentSession.hasMany(SessionMessage, { foreignKey: 'session_id', onDelete: 'CASCADE' })
SessionMessage.belongsTo(AgentSession, { foreignKey: 'session_id' })

export {
  Project,
  WebhookConfig,
  WebhookEvent,
  AgentSession,
  SessionMessage,
  AgentTemplate,
  ProjectAgent,
  AdminConfig,
  SystemNotification,
  DailyReport
}
