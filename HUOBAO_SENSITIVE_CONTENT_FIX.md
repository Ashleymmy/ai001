# Huobao-Drama 二次开发优化规划

> 本文档整合了敏感内容过滤问题修复与视频制作流程优化两方面的规划，作为 huobao-drama 二次开发的技术改进路线图。

---

## 一、当前问题总览

### 1.1 敏感内容过滤问题

使用 huobao-drama 生成图片或视频时，经常触发 AI 服务商的敏感内容过滤导致生成失败（被 ban），但使用主项目（AI Storyboarder）同样的提示词则很少出现此问题。

### 1.2 视频生产流程问题

当前默认流水线为：`文本 → 图片 → 视频 → 音频`

**核心矛盾**：
- 视频生成的时长粒度固定且短（常见 6–8 秒）
- 实际旁白/对白为保证叙事完整往往更长（信息密度高）
- 结果：后期出现大量音画无法同步、需要强行拉伸/切碎/补镜头的问题

### 1.3 与主项目对比的差异

| 维度 | 主项目（AI Storyboarder） | Huobao-Drama |
|------|-------------------------|-------------|
| **Prompt 参数处理** | 参数通过 API options 分离传递 | 直接拼接到 prompt 末尾 |
| **系统提示词** | 不包含敏感示例 | 包含详细错误示例（易被误识别） |
| **风格配置** | 标准化风格库 | 包含"Post-apocalyptic"等敏感词 |
| **视频 Prompt 结构** | 7 层结构化构建 | 简单透传 |
| **角色一致性** | 完整描述 + 参考图机制 | 依赖用户手动管理 |
| **音频处理** | 独立阶段，视频禁止人声 | 未明确分离 |

---

## 二、敏感内容过滤问题根因分析

### 问题1：Prompt 末尾参数追加方式（高风险）

**文件位置**: `demo/huobao-drama/application/services/image_generation_service.go:259-261`

```go
prompt := imageGen.Prompt
prompt += ", imageRatio:" + imageRatio  // ← 问题所在
result, err := client.GenerateImage(prompt, opts...)
```

**问题说明**:
- 直接在用户 prompt 末尾追加 `, imageRatio:16:9` 等参数
- 破坏 prompt 的语义完整性
- AI 服务商的安全过滤器可能将这种异常格式识别为可疑内容
- **对比主项目**：主项目将此类参数作为独立 options 传递，不污染 prompt

**影响范围**: 所有图像生成请求

---

### 问题2：系统提示词包含敏感词示例（高风险）

**文件位置**: `demo/huobao-drama/application/services/prompt_i18n.go`
**功能**: 场景提取的系统提示词 `GetSceneExtractionPrompt()`

**问题代码片段**（约第 962-1003 行）:
```
【错误示例（包含人物，禁止）】：
❌ "展现主角站在街道上的场景" - 包含人物
❌ "人们匆匆而过" - 包含人物
❌ "角色在房间里活动" - 包含人物
```

**问题说明**:
- 系统提示词中为了说明"禁止事项"而列出了详细的错误示例
- 这些示例文本本身会被发送给 AI 服务商
- AI 服务商的安全过滤器可能将这些"示例"识别为用户意图生成的内容
- **对比主项目**：主项目的系统提示词不包含任何敏感示例

**影响范围**: 场景提取、背景生成

---

### 问题3：默认风格配置包含敏感词汇（中风险）

**文件位置**: `demo/huobao-drama/configs/config.example.yaml:30-38`

```yaml
default_style: >-
  {
    "style_config": {
      "style_base": [
        "Japanese anime style",
        "Post-apocalyptic isekai narrative aesthetic",  # ← 敏感词
        ...
      ]
    }
  }
```

**问题说明**:
- `"Post-apocalyptic"（后末日/末世）` 可能触发敏感过滤
- 该风格配置会被嵌入到每个图像生成请求的 prompt 中

**影响范围**: 所有使用默认风格的图像/视频生成

---

### 问题4：分镜数据无过滤直接嵌入（中风险）

**文件位置**: `demo/huobao-drama/application/services/frame_prompt_service.go:392-449`

**涉及字段**:
- `Description`（镜头描述）
- `Action`（动作描述）
- `Dialogue`（对白）
- `Atmosphere`（氛围）
- `Result`（结果描述）

**问题说明**:
- 用户填写的分镜信息直接拼入最终 prompt，没有任何敏感词预检查
- **对比主项目**：主项目同样没有敏感词预检查，但 prompt 结构化程度更高，误触发概率更低

---

### 问题5：视频生成 Prompt 直接透传（低风险）

**文件位置**: `demo/huobao-drama/application/services/video_generation_service.go:289`

```go
result, err := client.GenerateVideo(imageURL, videoGen.Prompt, opts...)
```

**问题说明**:
- 视频 prompt 直接来自图像生成阶段，继承上游所有问题
- **对比主项目**：主项目有 7 层结构化的视频 prompt 构建，包含角色一致性、镜头类型映射、音频规则等

---

## 三、视频制作流程优化方案

### 3.1 推荐的新流程（音频先行）

```
文本脚本 → 音频（定节奏/定时长）→ 按音频切分镜头表 → 图片（关键帧）→ 视频（按段落时长）→ 合成
```

**核心思想**：把"时间轴的决定权"交给音频
- 音频先定稿 = 镜头数量、每个镜头时长、转折点都确定
- 后期从"对齐救火"变成"按规格装配"

### 3.2 镜头表字段（核心工单）

| 字段 | 说明 | 示例 |
|------|------|------|
| Timecode | 段落起止时间 | 00:12.3–00:18.9 |
| 音频文本 | 字幕源 | "她转身离开了房间" |
| 画面意图 | 信息承接/情绪/动作/转场 | 情绪转折 |
| 镜头类型 | 远/中/近、固定/运动 | 中景/轻推 |
| 视觉关键词 | 人物、场景、道具、光线 | 主角背影、昏暗走廊 |

### 3.3 切分建议

- **信息密集段**：3–6s/段
- **氛围铺垫段**：5–9s/段
- **任何 >10s 的段落**：建议拆分

### 3.4 主项目的视频 Prompt 结构（参考）

主项目 `agent_service.py:2712-2806` 的 7 层结构：

```python
parts = [
    resolved_scene,           # 1. 场景描述（已解析元素引用）
    character_consistency,    # 2. 角色一致性约束
    style,                    # 3. 视觉风格
    motion,                   # 4. 镜头运动（按 shot.type 映射）
    voice_cast_rule,          # 5. 角色音色设定
    audio_rules,              # 6. 音频规则（禁止人声）
    no_text                   # 7. 禁止文字/字幕
]
```

**镜头类型到运动的映射**：
```python
motion_map = {
    "standard": "自然流畅的角色动作与轻微镜头运动",
    "quick": "节奏更快的动作与镜头移动，保持画面稳定",
    "closeup": "以角色表情与细节为主，轻微推拉",
    "wide": "展示环境与空间关系，缓慢平移/推进",
    "montage": "更强的节奏感与剪辑感"
}
```

---

## 四、修复方案详细规划

### Phase 1：敏感内容问题修复（优先级：高）

#### 任务 1.1：修改 imageRatio 追加方式

**文件**: `demo/huobao-drama/application/services/image_generation_service.go`

**方案 A - 放到开头**（推荐）:
```go
prompt := "imageRatio:" + imageRatio + ". " + imageGen.Prompt
```

**方案 B - 使用换行分隔**:
```go
prompt := imageGen.Prompt + "\n\n[Image Ratio: " + imageRatio + "]"
```

**方案 C - 作为独立参数**（需确认 client 支持）:
```go
opts = append(opts, image.WithImageRatio(imageRatio))
```

---

#### 任务 1.2：精简系统提示词敏感示例

**文件**: `demo/huobao-drama/application/services/prompt_i18n.go`

**修改方案 - 移除错误示例，只保留正面要求**:
```go
【重要约束】：
- 生成的场景描述必须是纯背景，不包含任何人物或角色
- 确保描述的是空场景、环境、建筑、自然景观等
```

---

#### 任务 1.3：修改默认风格配置

**文件**:
- `demo/huobao-drama/configs/config.example.yaml`
- `demo/huobao-drama/configs/config.yaml`

**修改**:
```yaml
# 替换
"Post-apocalyptic isekai narrative aesthetic"
# 为
"Fantasy isekai narrative aesthetic"
```

---

### Phase 2：Prompt 结构优化（优先级：中）

#### 任务 2.1：参考主项目重构视频 Prompt 构建

**目标**: 将视频 prompt 从简单透传改为结构化构建

**新增内容**:
1. 角色一致性约束
2. 镜头类型到运动的映射
3. 音频规则（禁止人声）
4. 禁止文字/字幕规则

**文件**: `demo/huobao-drama/application/services/video_generation_service.go`

---

#### 任务 2.2：增加 Prompt 日志记录

在发送给 AI 服务商前，记录完整的最终 prompt，便于调试和问题排查。

---

### Phase 3：流程优化（优先级：低，可选）

#### 任务 3.1：支持"音频先行"模式

**新增功能**:
1. 音频上传/生成接口
2. 音频自动切分（按停顿/转折）
3. 镜头表自动生成
4. 按镜头表批量生成图片/视频

**涉及新增文件**:
- `application/services/audio_segmentation_service.go`
- `api/handlers/audio_segmentation.go`

---

#### 任务 3.2：添加敏感词预检查（可选）

**新增文件**: `demo/huobao-drama/pkg/utils/sensitive_filter.go`

**配置方式**（`config.yaml` 新增节点）:
```yaml
sensitive_filter:
  enabled: true
  action: "warn" | "replace" | "block"
  replacement: "[filtered]"
  lexicon_paths: ["path/to/words.txt"]
```

**接入位置**:
- 图像生成 prompt / negative_prompt
- 视频生成 prompt
- 帧提示词生成

---

## 五、执行计划总览

| 阶段 | 任务 | 文件 | 预期效果 | 工作量 | 优先级 |
|------|------|------|----------|--------|--------|
| P1 | 修改 imageRatio 追加方式 | `image_generation_service.go` | 降低格式导致的误判 | 小 | 高 |
| P1 | 精简系统提示词敏感示例 | `prompt_i18n.go` | 避免示例被误识别 | 小 | 高 |
| P1 | 修改默认风格配置 | `config.*.yaml` | 减少敏感词组合 | 小 | 高 |
| P2 | 重构视频 Prompt 构建 | `video_generation_service.go` | 提高 prompt 质量 | 中 | 中 |
| P2 | 增加 Prompt 日志记录 | 各 service 文件 | 便于调试 | 小 | 中 |
| P3 | 支持音频先行模式 | 新增文件 | 解决音画同步问题 | 大 | 低 |
| P3 | 添加敏感词预检查 | `pkg/utils/sensitive_filter.go` | 主动过滤敏感内容 | 中 | 低 |

---

## 六、验证方法

### 6.1 敏感内容修复验证

1. **对比测试**: 使用相同的剧本/提示词，分别在修复前后进行图像生成，对比被 ban 的概率
2. **日志检查**: 在 prompt 发送前打印日志，检查最终 prompt 内容
3. **边界测试**: 使用已知会触发敏感过滤的提示词进行测试

### 6.2 流程优化验证

1. **MVP 验证**: 选 30–60 秒旁白，完整跑通音频先行流程
2. **音画同步检查**: 口播关键名词出现时画面有承接
3. **一致性检查**: 同一角色外观稳定、同一场景色调一致

---

## 七、相关文件索引

### Huobao-Drama 项目

| 文件路径 | 功能 | 修改优先级 |
|---------|------|-----------|
| `application/services/image_generation_service.go` | 图像生成核心服务 | 高 |
| `application/services/prompt_i18n.go` | 国际化提示词模板 | 高 |
| `application/services/frame_prompt_service.go` | 分镜提示词生成 | 中 |
| `application/services/video_generation_service.go` | 视频生成服务 | 中 |
| `configs/config.example.yaml` | 配置模板 | 中 |
| `configs/config.yaml` | 用户本地配置 | 中 |

### 主项目参考（只读）

| 文件路径 | 功能 | 参考价值 |
|---------|------|----------|
| `backend/services/agent_service.py:2712-2806` | 视频 Prompt 构建 | 高 |
| `backend/services/agent_service.py:3670-3736` | 角色一致性提示 | 高 |
| `backend/services/agent_service.py:3642-3668` | 元素引用解析 | 中 |

---

## 八、注意事项

1. 本文档为规划文档，实际效果需测试验证
2. 不同 AI 服务商（豆包、OpenAI、Gemini 等）有不同的敏感词过滤策略
3. Phase 1 修复应优先执行，可快速见效
4. Phase 3 的音频先行模式改动较大，建议在 P1/P2 稳定后再考虑
5. 修复后仍可能存在个别 prompt 被过滤的情况，需持续优化

---

## 九、参考文档

- [视频制作流程优化.md](视频制作流程优化.md) - 音频先行流程详细 SOP
- [HUOBAO_SUBMODULE_GUIDE.md](HUOBAO_SUBMODULE_GUIDE.md) - Submodule 使用指南
