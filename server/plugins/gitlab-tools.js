import { definePluginEntry } from "openclaw/plugin-sdk/core";

// ── GitLab API 封装 ──────────────────────────────────────────

function buildHeaders(config) {
  const headers = { "Content-Type": "application/json" };
  if (config.gitlabToken) {
    headers["Authorization"] = `Bearer ${config.gitlabToken}`;
  }
  return headers;
}

async function gitlabApi(config, method, endpoint, body) {
  if (!config.gitlabBaseUrl) {
    throw new Error("gitlabBaseUrl is required in gitlab-tools plugin config");
  }
  const url = `${config.gitlabBaseUrl}${endpoint}`;
  const headers = buildHeaders(config);
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitLab API ${method} ${endpoint} failed (${res.status}): ${text}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

const PROJECT_ID_PARAM_DESC =
  "GitLab 项目 path_with_namespace（如 xxxx/demprob）或数字 gitlab_id；Webhook 调度时已由系统绑定，传错也会被自动纠正";

function getProjectId(params) {
  return params.project_id || params.projectId;
}

function getIssueIid(params) {
  return params.issue_iid || params.issueIid;
}

/** Webhook 调度经环境变量注入的项目标识，优先于 LLM 传入值 */
function boundProjectRef(pluginConfig) {
  const fromPath = process.env.BCENTER_GITLAB_PROJECT_PATH?.trim();
  if (fromPath) return fromPath;
  const fromId = process.env.BCENTER_GITLAB_ID?.trim();
  if (fromId) return fromId;
  return pluginConfig.defaultProjectId?.trim() || null;
}

function resolveProjectId(pluginConfig, params) {
  const bound = boundProjectRef(pluginConfig);
  const requested = getProjectId(params);
  if (bound) {
    if (requested && String(requested) !== bound) {
      console.warn(`[gitlab-tools] project_id overridden: ${requested} -> ${bound}`);
    }
    return bound;
  }
  if (!requested) {
    throw new Error("project_id is required (path_with_namespace or gitlab numeric id)");
  }
  return requested;
}

function resolveIssueIid(params) {
  const bound = process.env.BCENTER_ISSUE_IID?.trim();
  const requested = getIssueIid(params);
  if (bound) {
    if (requested && String(requested) !== bound) {
      console.warn(`[gitlab-tools] issue_iid overridden: ${requested} -> ${bound}`);
    }
    return bound;
  }
  return requested;
}

function getMrIid(params) {
  return params.mr_iid || params.mrIid;
}

// ── 注册工具 ──────────────────────────────────────────────────

export default definePluginEntry({
  id: "gitlab-tools",
  name: "GitLab Tools",
  description: "GitLab Issue 状态机管理工具 - 创建/查询/更新 Issue、MR 和标签",

  configSchema: {
    type: "object",
    properties: {
      gitlabToken: {
        type: "string",
        description: "GitLab Personal Access Token"
      },
      gitlabBaseUrl: {
        type: "string",
        description: "GitLab 实例基础 URL（必填，如 https://gitlab.com/api/v4）"
      },
      defaultProjectId: {
        type: "string",
        description: "默认项目 ID（可选）"
      }
    },
    additionalProperties: false
  },

  register(api) {
    const config = api.pluginConfig || {};

    // ── 1. gitlab_issue_get ──
    api.registerTool({
      name: "gitlab_issue_get",
      label: "GitLab: 获取 Issue",
      description: "获取 GitLab Issue 的详细信息",
      parameters: {
        type: "object",
        properties: {
          project_id: { type: "string", description: PROJECT_ID_PARAM_DESC },
          issue_iid: { type: "string", description: "Issue IID（编号）" }
        },
        required: ["project_id", "issue_iid"]
      },
      execute: async (toolCallId, params, signal, onUpdate) => {
        const issue = await gitlabApi(config, "GET", `/projects/${encodeURIComponent(resolveProjectId(config, params))}/issues/${resolveIssueIid(params)}`);
        return JSON.stringify(issue, null, 2);
      }
    });

    // ── 2. gitlab_issue_update ──
    api.registerTool({
      name: "gitlab_issue_update",
      label: "GitLab: 更新 Issue",
      description: "更新 GitLab Issue 的标签、状态、指派人等",
      parameters: {
        type: "object",
        properties: {
          project_id: { type: "string", description: PROJECT_ID_PARAM_DESC },
          issue_iid: { type: "string", description: "Issue IID" },
          state_event: {
            type: "string",
            enum: ["close", "reopen"],
            description: "状态变更事件（关闭/重新打开）"
          },
          labels: { type: "string", description: "标签列表，逗号分隔" },
          assignee_ids: {
            type: "array",
            items: { type: "number" },
            description: "指派用户 ID 列表"
          },
          title: { type: "string", description: "新标题" },
          description: { type: "string", description: "新描述" }
        },
        required: ["project_id", "issue_iid"]
      },
      execute: async (toolCallId, params, signal, onUpdate) => {
        const body = {};
        if (params.state_event) body.state_event = params.state_event;
        if (params.labels !== undefined) body.labels = params.labels;
        if (params.assignee_ids) body.assignee_ids = params.assignee_ids;
        if (params.title) body.title = params.title;
        if (params.description) body.description = params.description;
        const result = await gitlabApi(config, "PUT", `/projects/${encodeURIComponent(resolveProjectId(config, params))}/issues/${resolveIssueIid(params)}`, body);
        return JSON.stringify(result, null, 2);
      }
    });

    // ── 3. gitlab_issue_comment ──
    api.registerTool({
      name: "gitlab_issue_comment",
      label: "GitLab: 添加 Issue 评论",
      description: "在 GitLab Issue 上添加评论",
      parameters: {
        type: "object",
        properties: {
          project_id: { type: "string", description: PROJECT_ID_PARAM_DESC },
          issue_iid: { type: "string", description: "Issue IID" },
          body: { type: "string", description: "评论内容" }
        },
        required: ["project_id", "issue_iid", "body"]
      },
      execute: async (toolCallId, params, signal, onUpdate) => {
        const result = await gitlabApi(config, "POST", `/projects/${encodeURIComponent(resolveProjectId(config, params))}/issues/${resolveIssueIid(params)}/notes`, {
          body: params.body
        });
        return JSON.stringify(result, null, 2);
      }
    });

    // ── 4. gitlab_mr_list ──
    api.registerTool({
      name: "gitlab_mr_list",
      label: "GitLab: 查询 Issue 关联的 MR",
      description: "获取与 GitLab Issue 关联的合并请求列表",
      parameters: {
        type: "object",
        properties: {
          project_id: { type: "string", description: PROJECT_ID_PARAM_DESC },
          issue_iid: { type: "string", description: "Issue IID" },
          state: {
            type: "string",
            enum: ["opened", "merged", "closed", "all"],
            description: "MR 状态过滤"
          }
        },
        required: ["project_id", "issue_iid"]
      },
      execute: async (toolCallId, params, signal, onUpdate) => {
        const searchTerm = `#${resolveIssueIid(params)}`;
        const mrs = await gitlabApi(config, "GET",
          `/projects/${encodeURIComponent(resolveProjectId(config, params))}/merge_requests?search=${encodeURIComponent(searchTerm)}&in=description${params.state && params.state !== 'all' ? `&state=${params.state}` : ''}`
        );
        return JSON.stringify(mrs, null, 2);
      }
    });

    // ── 5. gitlab_mr_get ──
    api.registerTool({
      name: "gitlab_mr_get",
      label: "GitLab: 获取 MR 详情",
      description: "获取 GitLab 合并请求的详细信息，包括审批状态",
      parameters: {
        type: "object",
        properties: {
          project_id: { type: "string", description: PROJECT_ID_PARAM_DESC },
          mr_iid: { type: "string", description: "MR IID" }
        },
        required: ["project_id", "mr_iid"]
      },
      execute: async (toolCallId, params, signal, onUpdate) => {
        const mr = await gitlabApi(config, "GET", `/projects/${encodeURIComponent(resolveProjectId(config, params))}/merge_requests/${getMrIid(params)}`);
        let approvals = null;
        try {
          approvals = await gitlabApi(config, "GET", `/projects/${encodeURIComponent(resolveProjectId(config, params))}/merge_requests/${getMrIid(params)}/approvals`);
        } catch (e) {
          // 没有审批权限或非 Premium 版本
        }
        return JSON.stringify({ ...mr, approvals }, null, 2);
      }
    });

    // ── 6. gitlab_add_label ──
    api.registerTool({
      name: "gitlab_add_label",
      label: "GitLab: 添加标签",
      description: "为 GitLab Issue 添加标签",
      parameters: {
        type: "object",
        properties: {
          project_id: { type: "string", description: PROJECT_ID_PARAM_DESC },
          issue_iid: { type: "string", description: "Issue IID" },
          labels: { type: "string", description: "要设置的标签，逗号分隔" }
        },
        required: ["project_id", "issue_iid", "labels"]
      },
      execute: async (toolCallId, params, signal, onUpdate) => {
        const issue = await gitlabApi(config, "GET", `/projects/${encodeURIComponent(resolveProjectId(config, params))}/issues/${resolveIssueIid(params)}`);
        const existingLabels = (issue.labels || []);
        const newLabels = [...new Set([...existingLabels, ...params.labels.split(",").map(l => l.trim())])];
        const result = await gitlabApi(config, "PUT", `/projects/${encodeURIComponent(resolveProjectId(config, params))}/issues/${resolveIssueIid(params)}`, {
          labels: newLabels.join(",")
        });
        return JSON.stringify({ labels: result.labels }, null, 2);
      }
    });

    // ── 7. gitlab_set_state_label ──
    api.registerTool({
      name: "gitlab_set_state_label",
      label: "GitLab: 设置状态标签",
      description: "设置 GitLab Issue 的状态标签（待办/进行中/待验收/已完成/已取消），自动替换旧状态标签",
      parameters: {
        type: "object",
        properties: {
          project_id: { type: "string", description: PROJECT_ID_PARAM_DESC },
          issue_iid: { type: "string", description: "Issue IID" },
          state: {
            type: "string",
            enum: ["待办", "进行中", "待验收", "已完成", "已取消"],
            description: "目标状态"
          }
        },
        required: ["project_id", "issue_iid", "state"]
      },
      execute: async (toolCallId, params, signal, onUpdate) => {
        const issue = await gitlabApi(config, "GET", `/projects/${encodeURIComponent(resolveProjectId(config, params))}/issues/${resolveIssueIid(params)}`);
        const existingLabels = (issue.labels || []);
        const cleaned = existingLabels.filter(l => !l.startsWith("status::"));
        cleaned.push(`status::${params.state}`);
        const result = await gitlabApi(config, "PUT", `/projects/${encodeURIComponent(resolveProjectId(config, params))}/issues/${resolveIssueIid(params)}`, {
          labels: cleaned.join(",")
        });
        return JSON.stringify({ state: params.state, labels: result.labels }, null, 2);
      }
    });

    // ── 8. gitlab_flow_state ──
    api.registerTool({
      name: "gitlab_flow_state",
      label: "GitLab: 查询状态机当前状态",
      description: "查询 GitLab Issue 的当前状态机状态，以及可用的转移路径",
      parameters: {
        type: "object",
        properties: {
          project_id: { type: "string", description: PROJECT_ID_PARAM_DESC },
          issue_iid: { type: "string", description: "Issue IID" }
        },
        required: ["project_id", "issue_iid"]
      },
      execute: async (toolCallId, params, signal, onUpdate) => {
        const issue = await gitlabApi(config, "GET", `/projects/${encodeURIComponent(resolveProjectId(config, params))}/issues/${resolveIssueIid(params)}`);
        const labels = (issue.labels || []);
        const stateLabel = labels.find(l => l.startsWith("status::"));
        const currentState = stateLabel ? stateLabel.replace("status::", "") : "未标记";

        const transitions = {
          "待办": ["进行中", "已取消"],
          "进行中": ["待验收", "已取消"],
          "待验收": ["已完成", "进行中", "已取消"],
          "已完成": ["待办"],
          "已取消": ["待办"],
          "未标记": ["待办"]
        };

        return JSON.stringify({
          issue_iid: resolveIssueIid(params),
          title: issue.title,
          url: issue.web_url,
          current_state: currentState,
          available_transitions: transitions[currentState] || [],
          all_labels: labels
        }, null, 2);
      }
    });

    // ── 9. gitlab_project_info ──
    api.registerTool({
      name: "gitlab_project_info",
      label: "GitLab: 获取项目信息",
      description: "获取 GitLab 项目基本信息（用于确认 project_id）",
      parameters: {
        type: "object",
        properties: {
          project_id: { type: "string", description: PROJECT_ID_PARAM_DESC }
        },
        required: ["project_id"]
      },
      execute: async (toolCallId, params, signal, onUpdate) => {
        const project = await gitlabApi(config, "GET", `/projects/${encodeURIComponent(resolveProjectId(config, params))}`);
        return JSON.stringify({
          id: project.id,
          name: project.name,
          path_with_namespace: project.path_with_namespace,
          web_url: project.web_url,
          visibility: project.visibility
        }, null, 2);
      }
    });

    // ── 10. gitlab_mr_comment ──
    api.registerTool({
      name: "gitlab_mr_comment",
      label: "GitLab: 评论 MR",
      description: "在 GitLab 合并请求上添加评论",
      parameters: {
        type: "object",
        properties: {
          project_id: { type: "string", description: PROJECT_ID_PARAM_DESC },
          mr_iid: { type: "string", description: "MR IID" },
          body: { type: "string", description: "评论内容" }
        },
        required: ["project_id", "mr_iid", "body"]
      },
      execute: async (toolCallId, params, signal, onUpdate) => {
        const result = await gitlabApi(config, "POST",
          `/projects/${encodeURIComponent(resolveProjectId(config, params))}/merge_requests/${getMrIid(params)}/notes`,
          { body: params.body }
        );
        return JSON.stringify(result, null, 2);
      }
    });

    // ── 11. gitlab_mr_update ──
    api.registerTool({
      name: "gitlab_mr_update",
      label: "GitLab: 更新 MR",
      description: "更新 GitLab 合并请求的标题、描述、标签、指派人等",
      parameters: {
        type: "object",
        properties: {
          project_id: { type: "string", description: PROJECT_ID_PARAM_DESC },
          mr_iid: { type: "string", description: "MR IID" },
          title: { type: "string", description: "新标题" },
          description: { type: "string", description: "新描述" },
          labels: { type: "string", description: "标签列表，逗号分隔" },
          assignee_ids: { type: "array", items: { type: "number" }, description: "指派用户 ID 列表" },
          state_event: { type: "string", enum: ["close", "reopen"], description: "状态变更" }
        },
        required: ["project_id", "mr_iid"]
      },
      execute: async (toolCallId, params, signal, onUpdate) => {
        const body = {};
        if (params.title) body.title = params.title;
        if (params.description) body.description = params.description;
        if (params.labels !== undefined) body.labels = params.labels;
        if (params.assignee_ids) body.assignee_ids = params.assignee_ids;
        if (params.state_event) body.state_event = params.state_event;
        const result = await gitlabApi(config, "PUT",
          `/projects/${encodeURIComponent(resolveProjectId(config, params))}/merge_requests/${getMrIid(params)}`, body
        );
        return JSON.stringify(result, null, 2);
      }
    });

    // ── 12. gitlab_mr_merge ──
    api.registerTool({
      name: "gitlab_mr_merge",
      label: "GitLab: 合并 MR",
      description: "执行 GitLab 合并请求的合并操作",
      parameters: {
        type: "object",
        properties: {
          project_id: { type: "string", description: PROJECT_ID_PARAM_DESC },
          mr_iid: { type: "string", description: "MR IID" },
          merge_commit_message: { type: "string", description: "合并提交信息（可选）" },
          should_remove_source_branch: { type: "boolean", description: "合并后是否删除源分支" }
        },
        required: ["project_id", "mr_iid"]
      },
      execute: async (toolCallId, params, signal, onUpdate) => {
        const body = {};
        if (params.merge_commit_message) body.merge_commit_message = params.merge_commit_message;
        if (params.should_remove_source_branch !== undefined) body.should_remove_source_branch = params.should_remove_source_branch;
        const result = await gitlabApi(config, "PUT",
          `/projects/${encodeURIComponent(resolveProjectId(config, params))}/merge_requests/${getMrIid(params)}/merge`, body
        );
        return JSON.stringify(result, null, 2);
      }
    });

    // ── 13. gitlab_mr_approve ──
    api.registerTool({
      name: "gitlab_mr_approve",
      label: "GitLab: 审批 MR",
      description: "审批 GitLab 合并请求",
      parameters: {
        type: "object",
        properties: {
          project_id: { type: "string", description: PROJECT_ID_PARAM_DESC },
          mr_iid: { type: "string", description: "MR IID" }
        },
        required: ["project_id", "mr_iid"]
      },
      execute: async (toolCallId, params, signal, onUpdate) => {
        const result = await gitlabApi(config, "POST",
          `/projects/${encodeURIComponent(resolveProjectId(config, params))}/merge_requests/${getMrIid(params)}/approve`
        );
        return JSON.stringify(result, null, 2);
      }
    });

    // ── 14. gitlab_mr_add_label ──
    api.registerTool({
      name: "gitlab_mr_add_label",
      label: "GitLab: MR 添加标签",
      description: "为 GitLab 合并请求添加标签",
      parameters: {
        type: "object",
        properties: {
          project_id: { type: "string", description: PROJECT_ID_PARAM_DESC },
          mr_iid: { type: "string", description: "MR IID" },
          labels: { type: "string", description: "要设置的标签，逗号分隔" }
        },
        required: ["project_id", "mr_iid", "labels"]
      },
      execute: async (toolCallId, params, signal, onUpdate) => {
        const mr = await gitlabApi(config, "GET",
          `/projects/${encodeURIComponent(resolveProjectId(config, params))}/merge_requests/${getMrIid(params)}`
        );
        const existingLabels = (mr.labels || []);
        const newLabels = [...new Set([...existingLabels, ...params.labels.split(",").map(l => l.trim())])];
        const result = await gitlabApi(config, "PUT",
          `/projects/${encodeURIComponent(resolveProjectId(config, params))}/merge_requests/${getMrIid(params)}`,
          { labels: newLabels.join(",") }
        );
        return JSON.stringify({ labels: result.labels }, null, 2);
      }
    });
  }
});
