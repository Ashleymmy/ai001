/**
 * 功能模块：设置领域模型模块，提供 types 的类型定义与配置工具
 */

export type ProviderPreset = {
  id: string
  name: string
  baseUrl?: string
  models: string[]
}

export type CustomProviderFormData = {
  name: string
  apiKey: string
  baseUrl: string
  model: string
  models: string[]
}

