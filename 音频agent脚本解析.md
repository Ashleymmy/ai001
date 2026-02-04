**必须加新的脚本解析规则**不只是“多加几个字段”这么简单。你现在的系统从“视频为主时钟”改成“音频为主时钟”，等价于：整个 Agent pipeline 的**规范输入（script spec）**、**中间表示（IR）**、**约束校验（validators）**都要升级，否则各个 Agent 会各说各话，最后还是回到后期对齐地狱。

下面我给你一套比较工程化的改造方案：你可以直接把它当作你项目的“脚本协议升级说明”。

---

## 1) 结论先说：要做两套新规则，但最好是“一套脚本协议 + 两个解析器视图”

### 为什么不建议“音频 Agent 一套规则，视频 Agent 另一套规则”

两套规则很快会分叉（字段叫法、粒度、默认值、边界条件），最后你会陷入“同步两份规范”的维护成本。

### 更稳的做法

* 定义一个统一的 **Script Spec v2（Audio-First）** 作为唯一真相（single source of truth）
* 音频编排 Agent 和视频制作 Agent 都解析同一份 spec，但使用不同的视图：

  * **Audio View**：关注 Beat、time budget、VO/DIA、SFX/AMB、转场锚点
  * **Video View**：关注 Shot、镜头类型、角色/场景/道具锚点、生成提示词骨架、时长对齐

> 关键点：**音频 Agent 输出“时间轴（timecode）”与“段落级约束”**，视频 Agent 只能在这个约束内生成与装配。

---

## 2) 你需要新增的“脚本解析规则”有哪些（按必需程度排序）

### A. 新增一个“主时钟层”：Beat（音频段）必须成为一级结构

以前很多项目脚本结构是 Scene → Shot（或直接一串 Shot）。
Audio-First 必须变为：

* **Scene（场）**

  * **Beat（音频段/节拍）** ← 主时钟单位（必须有时长/目标）

    * Shot（一个或多个镜头，服务于该 Beat）

**解析规则：**

* 每个 Beat 都必须可生成一段音频（VO 或 DIA 或纯 SFX/AMB）
* 每个 Shot 必须绑定到一个 Beat（禁止游离镜头）

---

### B. 必须引入“时长约束字段”并定义优先级

你要解决的就是时长，所以脚本必须在语法层面支持“时长”。

建议字段与优先级：

1. `beat.timecode`（最终锁定，来自音频 Agent 或外部标注）**最高优先级**
2. `beat.target_duration`（脚本作者的预算）
3. `shot.duration_policy`（例如固定 6s、或允许裁切）

**解析规则：**

* 若存在 `beat.timecode`，视频 Agent 必须严格对齐（允许“生成 6s → 裁切到 4.2s”这类策略，但时间线不变）
* 若仅有 `target_duration`，音频 Agent 负责生成并回填 `timecode`

---

### C. VO / DIA / SFX / AMB 必须结构化，而不是“写在自然语言里”

否则音频 Agent 无法稳定抽取与编排。

**解析规则（最小）**：

* `audio.vo`：旁白文本（可带停顿标记）
* `audio.dia[]`：对白数组（角色、台词、口型风险标记）
* `audio.sfx[]`：音效事件（名称、触发点、强度）
* `audio.amb`：环境氛围（场景底噪/空间）

并且要支持：

* `audio.pause_markers` 或在 VO 文本里用标准标记（`[beat] [pause] [hold]`）

---

### D. 你必须把“一致性锚点（Anchors）”变成脚本原语

否则视频 Agent 无法保证人物/场景/道具一致性。

**解析规则（建议）**：

* `anchors.character_ref`：引用角色卡（而不是每段重复写人物描述）
* `anchors.location_ref`：引用场景卡
* `anchors.prop_refs[]`：引用道具卡（例如水苍玉吊坠）
* `anchors.forbidden_changes[]`：禁止变化项（发型/衣服/吊坠形态等）

---

### E. 新增“转场与衔接”的结构字段（避免 PPT 拼接感）

Audio-First 的衔接更应该用音频来设计，因此脚本要能表达：

* `transition.in`：J-cut / hard / amb_bridge / sfx_hit
* `transition.out`：L-cut / music_tail / match_cut
* `hooks`：用于桥接的钩子（铃声、门响、警笛、道具特写等）

视频 Agent 不应“自由发挥”，而应按转场策略装配。

---

## 3) 两个 Agent 分别需要怎么“解析与工作”（职责边界要硬）

### 3.1 音频编排 Agent（新增）——它的输出是“硬约束”

**输入（来自脚本）**：

* Scene/Beat 结构
* VO/DIA 文本 + 停顿标记
* 情绪标签、节奏提示
* SFX/AMB 需求
* target_duration（如果脚本给了）

**输出（写回 IR）**：

* `beat.timecode`（start/end）
* `audio.plan`（每段 VO/DIA 的实际语速、停顿、重音、情绪）
* `audio.events`（SFX/AMB 的时间点）
* `beat.validation`（是否超长、信息密度过高、对白口型风险）

> 关键：音频 Agent 输出之后，**时间线被冻结**，后续 Agent 不允许改 timecode，只能申请“改稿”（显式 replan）。

---

### 3.2 视频制作 Agent（原有）——它只负责“在约束内做最优画面”

**输入（来自 IR）**：

* `beat.timecode`（强约束）
* Beat 的 Visual Intent（画面任务）
* Anchors（角色/场景/道具引用）
* 镜头语言（景别/机位/运动限制）
* 口型风险标记（决定是否用正面说话）

**输出**：

* `shotlist`（一 Beat 一主镜头 + 可选补镜头）
* 每个 shot 的生成提示词骨架（prompt_core + negative + anchors）
* 资产命名与版本策略（shot_012_v3）

---

## 4) 推荐的统一脚本格式（能解析、能扩展、能校验）

最实用的是：**Markdown + YAML front matter + 表格/块**，兼顾可读与可解析。

### 4.1 Script Spec v2 示例（片段）

```yaml
---
spec: script_v2_audio_first
title: "水苍玉（示例）"
format: 16:9
clip_duration_default: 7.0
constraints:
  max_shot_seconds: 8.0
  prefer_voiceover: true
assets:
  characters:
    - id: char_ningqiqi
      ref: "characters/ningqiqi"
    - id: char_xiaoji
      ref: "characters/xiaoji"
  locations:
    - id: loc_ktv
      ref: "locations/ktv_room"
  props:
    - id: prop_shuicangyu
      ref: "props/shuicangyu_cross"
---
```

#### Scene / Beat 块（可解析）

```md
## Scene 01: KTV 醒来（loc_ktv）

### Beat B01
- target_duration: 7.0
- emotion: "panic"
- anchors:
  characters: [char_xiaoji]   # 身体
  props: [prop_shuicangyu]
- audio:
  vo: "我是在疼痛里醒来的。[pause] 天花板的灯在旋转。"
  amb: "ktv_low_bass_reverb"
  sfx:
    - name: "neon_hum"
      at: "auto"
- visual_intent: "建立环境与不适感"
- transition_out: "amb_bridge"

### Beat B02
- target_duration: 7.0
- emotion: "shock"
- audio:
  vo: "我侧过头，看见地上躺着一个人——那是我自己。"
  sfx:
    - name: "heartbeat_hit"
      at: "vo_emphasis"
- visual_intent: "反转：尸体"
- risk:
  lip_sync: false
```

> 你可以看到：音频字段可抽取、可编排；anchors 可保证一致性；transition 可指导装配。

---

## 5) 必须加的“校验器（validators）”——否则脚本再规范也会被用坏

建议至少 8 个校验规则（自动报错/告警）：

1. **Beat 覆盖性**：每个 Scene 必须至少 1 Beat
2. **绑定性**：每个 Shot 必须指向 Beat（或由视频 Agent 自动生成 Shot）
3. **时长合法性**：Beat 的 target_duration/ timecode 不得超过 max_shot_seconds（可允许拆分建议）
4. **音频存在性**：Beat 必须有 VO/DIA/SFX/AMB 至少一个（纯画面段也要有 amb）
5. **信息密度告警**：VO 字数/秒超过阈值提示“要拆句或加停顿”
6. **口型风险告警**：DIA 且 `lip_sync=true` 的 Beat 要求视频镜头必须标注“规避策略”（背影/侧脸/遮挡）
7. **锚点一致性**：同一 prop/character 在不同 Beat 的描述不允许冲突（靠 ref 解决）
8. **转场完整性**：每个 Beat 至少有 transition_out 或 hooks（防 PPT）

---

## 6) Agent 间接口：用一个 IR（中间表示）做“合同”

你改造 agent 项目，最容易踩坑的是：Agent 之间传字符串 prompt，信息丢失且不可追溯。

建议 IR 用 JSON/YAML 形式（内部），核心对象：

* `Scene[]`

  * `Beat[]`

    * `audio_plan`
    * `timecode`
    * `anchors`
    * `visual_intent`
    * `shots[]`（由视频 Agent 填）
    * `validation[]`（由校验器填）

这样任何一步出问题都能定位到具体 Beat。

---

## 7) 最小改造路径（不推翻原项目的前提下加进去）

你说“基于原有一般视频创作 agent 项目改造”，建议按最小侵入做：

1. **在原 pipeline 前面插入 Audio Orchestrator Agent**
2. 让它产出：

   * `beat.timecode` + `audio_plan` + `events`
3. 原视频 Agent 不改核心生成逻辑，但改输入：

   * 以前：给一段文本 → 出一个视频
   * 现在：给一个 Beat（含 timecode/anchors/intent）→ 出一个对应时长的视频片段
4. 最后加一个 **Assembler Agent**（装配器）：

   * 音频锁定
   * 按 timecode 放片段
   * 执行转场规则（J/L-cut、音桥等）

> 这条路径能让你保持原有视频生成能力，只是把“控制权”前置到音频时间线。

---

