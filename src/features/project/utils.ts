export function formatTime(isoString: string): string {
  const date = new Date(isoString)
  return date.toLocaleString('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

export function getActionText(action: string): string {
  const map: Record<string, string> = {
    created: '创建项目',
    updated: '更新项目',
    storyboard_added: '添加分镜',
    storyboard_updated: '更新分镜',
    storyboard_deleted: '删除分镜',
    script_updated: '更新剧本',
    style_changed: '修改风格',
    reference_updated: '更新参考图'
  }
  return map[action] || action
}

