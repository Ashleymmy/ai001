/**
 * 功能模块：项目领域模型模块，提供 types 的类型与业务辅助函数
 */

export interface HistoryItem {
  action: string
  timestamp: string
  data?: unknown
}
