# API 监控（火山官方配额）配置与使用

更新日期：2026-02-25

## 1. 功能说明

项目已支持在监控页直接配置火山官方配额查询参数，并在“上游 API 状态与余量”中展示 Token 余量。

- 优先展示上游接口返回的标准 `rate-limit` 头（如有）。
- 若无标准头，且为火山相关 provider，则回退到火山官方配额中心查询结果。

> 注意：这里的 AK/SK 是火山 OpenAPI 的访问密钥，不是你调用模型的 API Key。

---

## 2. 前端配置入口

页面路径：`/home/api-monitor`  
卡片名称：`火山官方配额配置`

可配置字段：

- `Access Key (AK)`：必填（用于官方配额接口签名）
- `Secret Key (SK)`：必填（用于官方配额接口签名）
- `Region`：可选，默认 `cn-beijing`
- `ProviderCode`：可选，留空时系统自动尝试匹配
- `QuotaCode`：可选，留空时系统自动尝试匹配

按钮行为：

- `保存配置`：保存并刷新后端探测配置
- `清空 AK` / `清空 SK`：清空已保存密钥

---

## 3. 配置保存位置

配置保存在本机文件：

- `backend/data/api_monitor.local.yaml`

用于监控配额探测，不会改动你业务模型调用配置（例如模块设置里的 API Key）。

---

## 4. 如何获取 AK/SK

推荐流程：

1. 登录火山引擎控制台。
2. 按官方文档创建/查看访问密钥（建议使用子账号最小权限）。
3. 将得到的 AK/SK 填入监控页并保存。

官方文档：

- 访问密钥概述：<https://www.volcengine.com/docs/6257/64983>

---

## 5. 如何获取 ProviderCode / QuotaCode（可选）

你可以先留空，让系统自动匹配；如果自动匹配不准，再手动指定。

查询方式：

1. 通过 `ListProducts` 获取 `ProviderCode`
2. 通过 `ListProductQuotas` 获取目标 `QuotaCode`

官方文档：

- `ListProducts`：<https://www.volcengine.com/docs/6837/129550>
- `ListProductQuotas`：<https://www.volcengine.com/docs/6837/129551>
- 配额项示例（含 `ai-gateway-token-limit`）：<https://www.volcengine.com/docs/6893/1456325>

示例（仅示例，实际以你账号查询结果为准）：

- `ProviderCode`: `vei_api`
- `QuotaCode`: `ai-gateway-token-limit`

---

## 6. 使用验证

配置保存后：

1. 进入监控页点击 `刷新`
2. 查看 `上游 API 状态与余量` 表格
3. 在 `剩余 Tokens` 列观察结果

当显示 `数据源：火山官方配额中心` 时，说明正在使用官方配额查询回退数据。

---

## 7. 常见问题

### Q1：提示“未配置 VOLCENGINE_ACCESS_KEY / VOLCENGINE_SECRET_KEY”

说明当前监控配置里没有有效 AK/SK。请在监控页保存 AK/SK。

### Q2：提示“官方 token 配额查询失败”

建议检查：

- AK/SK 是否正确
- `Region` 是否正确（通常 `cn-beijing`）
- 账号是否具备配额中心相关权限
- `ProviderCode` / `QuotaCode` 是否填错

### Q3：提示“未匹配到 token 配额项”

自动匹配没有命中，建议手动填写 `ProviderCode` 和 `QuotaCode`。

### Q4：模型接口显示“鉴权失败”，但配额查询正常

这是两套凭证：

- 模型调用使用业务 API Key（模块/Agent 设置里配置）
- 配额查询使用 AK/SK（监控页配置）

两者互不替代。

---

## 8. 相关接口（开发参考）

- `GET /api/monitor/config`：读取监控探测配置（密钥脱敏）
- `POST /api/monitor/config`：更新监控探测配置
- `GET /api/monitor/providers`：探测上游状态，返回 `token_quota`（如命中）

`POST /api/monitor/config` 请求体示例：

```json
{
  "volcengine": {
    "access_key": "AK...",
    "secret_key": "SK...",
    "region": "cn-beijing",
    "provider_code": "vei_api",
    "quota_code": "ai-gateway-token-limit"
  }
}
```

