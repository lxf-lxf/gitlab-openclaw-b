import AdminConfig from './models/adminConfig.js'
import AgentTemplate from './models/agentTemplate.js'
import config from '../config.js'

const defaults = [
  { config_key: 'gitlab_token', config_value: '', description: 'GitLab 超级管理员 Personal Access Token' },
  { config_key: 'gitlab_base_url', config_value: config.gitlab.baseUrl, description: 'GitLab 实例 URL' },
  { config_key: 'bot_name', config_value: 'GitLab Bot', description: '机器人名称' },
  { config_key: 'webhook_base_url', config_value: config.webhook.baseUrl, description: 'Webhook 局域网回调地址（GitLab 能够访问的本机 IP）' }
]

const defaultAgentTemplates = [
  {
    name: 'webhook-status-flow',
    description: '接收所有 GitLab Webhook 事件，自动执行 Issue 状态标签流转。需要开发时调用 supervisor-dev Agent。',
    trigger_mode: 'event',
    agent_config: {
      instructions: `你是 GitLab Webhook 状态流转 Agent。

## 核心职责
接收 GitLab Webhook 事件通知，执行 Issue 状态标签流转。

## 状态流转规则
- 使用 gitlab_set_state_label 设置状态标签（待办/进行中/待验收/已完成/已取消）
- 使用 gitlab_flow_state 查询当前状态和可用转移路径
- 使用 gitlab_issue_comment 在 Issue 上评论状态变更
- 不要回复 Issue 技术内容，只做状态变更和状态评论

## 规则
- 仅在里程碑变更时标记为"进行中"
- 跳过 bot 自身触发的事件（用户名为 devops-robot）`,
      tools: ['gitlab_issue_get', 'gitlab_set_state_label', 'gitlab_flow_state', 'gitlab_issue_comment',
        'gitlab_project_info', 'gitlab_mr_get', 'gitlab_mr_list', 'gitlab_mr_comment',
        'gitlab_mr_update', 'gitlab_mr_merge', 'gitlab_mr_add_label'],
      event_types: ['Issue Hook', 'Merge Request Hook', 'Note Hook'],
      triggers: [
        { event_type: 'Issue Hook', actions: ['open', 'update', 'close', 'reopen'] },
        { event_type: 'Merge Request Hook', actions: ['open', 'update', 'merge', 'close', 'reopen'] },
        { event_type: 'Note Hook', noteable_types: ['Issue'] },
        { event_type: 'Issue Hook', milestone_only: true, actions: ['update'] }
      ],
      execute_order: 0,
      chain: [
        { agent: 'supervisor-dev', when: ['issue', 'mr', 'milestone', 'develop_comment'] }
      ],
      auto_reply: true
    },
    is_active: 1,
    deployed: 0
  },
  {
    name: 'supervisor-dev',
    description: '由 webhook-status-flow Agent 调用的自定义开发 Agent。自动完成 git clone → 改代码 → push → 创建 MR 的完整开发流程。',
    trigger_mode: 'manual',
    agent_config: {
      instructions: `你是 Supervisor 开发 Agent，由 webhook-status-flow Agent 调用执行开发任务。

## 开发流程

### 1. 分析需求
根据收到的 Issue/MR 标题和描述分析需求，确定需要修改的代码。

### 2. 代码开发
- git clone 项目到临时目录
- 创建 feature 分支
- 根据分析结果修改代码

### 3. 设置 Issue 状态
使用 gitlab_set_state_label 设置状态为"待验收"

### 4. 创建 Merge Request
通过 GitLab API 创建 MR，关联 Issue，提交到 master 分支

### 5. 评论完成
使用 gitlab_issue_comment 评论变更详情、分支名和 MR 链接

### 6. 清理
删除临时目录`,
      tools: ['gitlab_issue_get', 'gitlab_issue_update', 'gitlab_issue_comment', 'gitlab_add_label', 'gitlab_set_state_label', 'gitlab_flow_state', 'gitlab_mr_get', 'gitlab_mr_list', 'gitlab_project_info'],
      auto_reply: true
    },
    is_active: 1,
    deployed: 0
  }
]

/**
 * 仅做幂等的首次初始化：
 * - AdminConfig：缺失时补齐
 * - AgentTemplate：表为空时写入内置模板（不自动 deployed，不覆盖已有配置）
 */
export async function seedDefaults() {
  for (const item of defaults) {
    await AdminConfig.findOrCreate({
      where: { config_key: item.config_key },
      defaults: item
    })
  }
  console.log('Default configs seeded.')

  const templateCount = await AgentTemplate.count()
  if (templateCount === 0) {
    for (const tpl of defaultAgentTemplates) {
      await AgentTemplate.create(tpl)
    }
    console.log('Default agent templates created (deploy manually via UI).')
  }
}
