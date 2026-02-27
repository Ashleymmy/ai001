# 新增独立"长篇制作工作台"模块 — 设计方案

## Context

用户需要一个**独立的长篇精细化视频制作工作台**，与现有 Agent 模块完全隔离：
- 现有 Agent 保留用于简单任务（30-60秒短片）
- 新工作台专注长篇、多幕、高质量故事制作（如竹取物语：5500字/5幕/14角色）
- 独立维护升级，最小化改动主项目
- 存储从 YAML 升级为 SQLite
- 全新定制 UI

### 现有架构特征（利用）
- **双运行时模式**：Agent Runtime（settings.yaml）vs Module Runtime（module.settings.yaml）— 新工作台可复用此模式，建立第三套独立配置
- **工具服务可复用**：LLMService、ImageService、VideoService、TTSService 均为独立类，接口干净，可直接实例化
- **前端路由支持独立页面**：Agent 已有独立路由 `/agent/*`（无侧边栏），新工作台同理
- **前端 Keep-Alive 缓存**：可选择性加入

---

## 架构总览

```
主项目（最小改动）                    新工作台（独立模块）
┌─────────────────┐                ┌──────────────────────────────┐
│ App.tsx          │  跳转入口      │ StudioPage.tsx (新)           │
│  +路由 /studio/* │ ──────────→   │  - 系列管理面板               │
│                  │                │  - 分幕预览/编辑              │
│ HomePage.tsx     │                │  - 共享元素库                 │
│  +入口卡片       │                │  - 分集制作工作流             │
│                  │                │  - 独立设置面板               │
│ Layout.tsx       │                │  - 时间线/预览               │
│  +导航图标(可选) │                └────────────┬─────────────────┘
└─────────────────┘                             │ REST API
                                    ┌────────────┴─────────────────┐
主项目后端（最小改动）                │ studio_service.py (新)        │
┌─────────────────┐                │  - 系列 CRUD                  │
│ main.py          │                │  - 大脚本分幕拆解             │
│  +注册 studio    │                │  - 共享元素管理               │
│   路由组         │                │  - 分集规划调度               │
│                  │                │  - 工具层定制适配             │
│ agent_service.py │                │                              │
│  (不改动)        │                │ studio_storage.py (新)        │
│                  │                │  - SQLite 存储                │
│ storage_service  │                │  - 系列/集/元素/镜头表        │
│  (不改动)        │                │  - 迁移脚本                   │
└─────────────────┘                └──────────────────────────────┘
                                            │
                                   复用现有工具服务（不改动）
                                   ┌─────────────────────┐
                                   │ LLMService           │
                                   │ ImageService          │
                                   │ VideoService          │
                                   │ TTSService            │
                                   └─────────────────────┘
```

---

## Part 1：SQLite 存储层 — `backend/services/studio_storage.py`（新文件）

### 数据库文件
```
backend/data/studio.db
```

### 表结构

```sql
-- 系列表
CREATE TABLE series (
    id          TEXT PRIMARY KEY,          -- "series_{8char}"
    name        TEXT NOT NULL,
    description TEXT DEFAULT '',
    series_bible TEXT DEFAULT '',          -- 世界观/人物设定/时间线
    visual_style TEXT DEFAULT '',          -- 全系列视觉风格
    source_script TEXT DEFAULT '',         -- 原始完整脚本
    settings    TEXT DEFAULT '{}',         -- JSON: 工作台专属设置覆盖
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

-- 幕/集表（一个系列下多集）
CREATE TABLE episodes (
    id          TEXT PRIMARY KEY,          -- "ep_{8char}"
    series_id   TEXT NOT NULL REFERENCES series(id) ON DELETE CASCADE,
    act_number  INTEGER NOT NULL,          -- 幕序号（1,2,3...）
    title       TEXT DEFAULT '',
    summary     TEXT DEFAULT '',           -- 本集摘要
    script_excerpt TEXT DEFAULT '',        -- 本集对应的脚本片段
    creative_brief TEXT DEFAULT '{}',      -- JSON: 本集制作简报
    target_duration_seconds REAL DEFAULT 60.0,
    status      TEXT DEFAULT 'draft',      -- draft/planned/in_progress/completed
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

-- 共享元素表（系列级，跨集复用）
CREATE TABLE shared_elements (
    id          TEXT PRIMARY KEY,          -- "SE_{8char}"
    series_id   TEXT NOT NULL REFERENCES series(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    type        TEXT NOT NULL,             -- character/scene/object
    description TEXT DEFAULT '',           -- 详细视觉描述
    voice_profile TEXT DEFAULT '',         -- 角色音色设定（character 类型）
    image_url   TEXT DEFAULT '',           -- 生成的参考图
    image_history TEXT DEFAULT '[]',       -- JSON: 图片历史
    reference_images TEXT DEFAULT '[]',    -- JSON: 用户上传参考图
    appears_in_episodes TEXT DEFAULT '[]', -- JSON: 出现的集ID列表
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

-- 分镜表（属于某集）
CREATE TABLE shots (
    id          TEXT PRIMARY KEY,          -- "shot_{8char}"
    episode_id  TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
    segment_name TEXT DEFAULT '',          -- 所属段落名
    sort_order  INTEGER NOT NULL,          -- 排序序号
    name        TEXT DEFAULT '',
    type        TEXT DEFAULT 'standard',   -- standard/wide/closeup/quick/montage
    duration    REAL DEFAULT 5.0,
    description TEXT DEFAULT '',
    prompt      TEXT DEFAULT '',           -- 起始帧提示词
    video_prompt TEXT DEFAULT '',          -- 视频生成提示词
    narration   TEXT DEFAULT '',           -- 旁白
    dialogue_script TEXT DEFAULT '',       -- 对白
    start_image_url TEXT DEFAULT '',
    video_url   TEXT DEFAULT '',
    audio_url   TEXT DEFAULT '',
    status      TEXT DEFAULT 'pending',    -- pending/generating/completed/failed
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

-- 集级元素引用表（记录某集使用了哪些共享元素 + 集特有元素）
CREATE TABLE episode_elements (
    id          TEXT PRIMARY KEY,
    episode_id  TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
    shared_element_id TEXT,                -- 引用共享元素ID（NULL表示集特有）
    name        TEXT NOT NULL,
    type        TEXT NOT NULL,
    description TEXT DEFAULT '',
    voice_profile TEXT DEFAULT '',
    image_url   TEXT DEFAULT '',
    is_override INTEGER DEFAULT 0,         -- 是否覆盖了共享元素的描述
    created_at  TEXT NOT NULL
);
```

### StudioStorage 类接口

```python
class StudioStorage:
    def __init__(self, db_path: str = "backend/data/studio.db"):
        """初始化 SQLite 连接，自动建表"""

    # === 系列 CRUD ===
    def create_series(self, name, description, source_script, ...) -> Dict
    def get_series(self, series_id) -> Optional[Dict]
    def list_series(self, limit=50) -> List[Dict]
    def update_series(self, series_id, updates: Dict) -> Optional[Dict]
    def delete_series(self, series_id) -> bool

    # === 集 CRUD ===
    def create_episode(self, series_id, act_number, title, ...) -> Dict
    def get_episode(self, episode_id) -> Optional[Dict]
    def list_episodes(self, series_id) -> List[Dict]
    def update_episode(self, episode_id, updates: Dict) -> Optional[Dict]
    def delete_episode(self, episode_id) -> bool

    # === 共享元素 ===
    def add_shared_element(self, series_id, name, type, description, ...) -> Dict
    def get_shared_elements(self, series_id) -> List[Dict]
    def update_shared_element(self, element_id, updates) -> Optional[Dict]
    def delete_shared_element(self, element_id) -> bool

    # === 镜头 ===
    def add_shot(self, episode_id, ...) -> Dict
    def get_shots(self, episode_id) -> List[Dict]
    def update_shot(self, shot_id, updates) -> Optional[Dict]
    def delete_shot(self, shot_id) -> bool
    def reorder_shots(self, episode_id, shot_ids: List[str]) -> bool

    # === 集元素引用 ===
    def inherit_shared_elements(self, episode_id, series_id) -> List[Dict]
    def get_episode_elements(self, episode_id) -> List[Dict]

    # === 导出/快照 ===
    def get_episode_snapshot(self, episode_id) -> Dict
    def get_series_snapshot(self, series_id) -> Dict
```

---

## Part 2：工作台服务 — `backend/services/studio_service.py`（新文件，核心）

### 工具层定制适配

新工作台实例化自己的一套工具服务，配置可独立于 Agent 和 Module：

```python
class StudioService:
    def __init__(self, storage: StudioStorage):
        self.storage = storage
        # 工具服务实例（启动时从 studio.settings.local.yaml 加载）
        self.llm: Optional[LLMService] = None
        self.image: Optional[ImageService] = None
        self.video: Optional[VideoService] = None
        self.tts: Optional[TTSService] = None

    def configure(self, settings: Dict):
        """从设置中初始化工具服务实例"""
        self.llm = LLMService(
            provider=settings["llm"]["provider"],
            api_key=settings["llm"]["apiKey"],
            ...
        )
        # 同理初始化 image, video, tts
```

### 核心方法

**A. 大脚本分幕拆解**
```python
async def split_script_to_acts(
    self,
    full_script: str,
    preferences: Dict  # {target_episode_count, episode_duration, style}
) -> List[Dict]:
    """
    LLM 分析脚本结构，识别自然分幕点。
    策略：此步只做拆分（不做完整规划），输入大但输出结构简单。
    max_tokens=4000 足够输出分幕列表。
    """
```

**B. 共享元素提取**
```python
async def extract_shared_elements(
    self,
    full_script: str,
    acts: List[Dict]
) -> List[Dict]:
    """
    从完整脚本提取贯穿全剧的角色/场景/道具。
    输出包含 name, type, description, voice_profile, appears_in_acts。
    """
```

**C. 创建系列（编排 A+B）**
```python
async def create_series(
    self,
    name: str,
    full_script: str,
    preferences: Dict
) -> Dict:
    """
    完整流程：
    1. split_script_to_acts() → 分幕
    2. extract_shared_elements() → 共享元素
    3. 写入 SQLite（series + episodes + shared_elements）
    4. 返回系列概览
    """
```

**D. 分集规划**
```python
async def plan_episode(
    self,
    episode_id: str
) -> Dict:
    """
    为单集生成详细规划：
    1. 从 SQLite 读取 episode + series_bible + shared_elements
    2. 组装 series_context（Bible + 共享元素描述 + 前后集摘要）
    3. 调用 LLM 生成分镜规划（类似 agent_service.plan_project 的逻辑，但独立实现）
    4. 共享元素自动继承到集元素
    5. 结果写入 shots 表
    """
```

**E. 单集分镜增强（Script Doctor）**
```python
async def enhance_episode(
    self,
    episode_id: str,
    mode: str = "refine"  # refine/expand
) -> Dict:
    """
    对单集分镜做 Script Doctor 式增强。
    独立实现，不依赖 agent_service。
    """
```

**F. 生成调度**
```python
async def generate_element_image(self, element_id: str, ...) -> Dict
async def generate_shot_frame(self, shot_id: str, ...) -> Dict
async def generate_shot_video(self, shot_id: str, ...) -> Dict
async def generate_shot_audio(self, shot_id: str, ...) -> Dict
async def batch_generate_episode(self, episode_id: str, stages: List[str]) -> Dict
```

### 工具层定制点（相对于现有 Agent 的区别）

| 维度 | Agent（现有） | Studio（新工作台） |
|------|-------------|------------------|
| LLM max_tokens | 8000 | 16000（规划）/ 4000（拆分） |
| 元素共享 | 项目内隔离 | 系列级共享 + 集级继承 |
| 存储 | YAML 文件 | SQLite |
| 分镜策略 | 单次 LLM → 全量规划 | 先拆幕 → 再逐集规划 |
| 角色一致性 | 仅 [Element_XXX] 引用 | 共享元素库 + 参考图继承 |
| 音色 | 每次重新选择 | 系列级绑定，跨集一致 |

---

## Part 3：API 路由 — `backend/main.py`（小改）

在 main.py 中注册新的路由组，全部以 `/api/studio/` 为前缀：

```python
# ========== Studio 工作台路由 ==========

# 系列
POST   /api/studio/series                    # 创建系列（含脚本 → 自动分幕+提取元素）
GET    /api/studio/series                    # 列出所有系列
GET    /api/studio/series/{id}               # 获取系列详情
PUT    /api/studio/series/{id}               # 更新系列信息
DELETE /api/studio/series/{id}               # 删除系列

# 分集
GET    /api/studio/series/{id}/episodes      # 列出该系列所有集
POST   /api/studio/episodes/{ep_id}/plan     # 为单集生成规划
POST   /api/studio/episodes/{ep_id}/enhance  # 增强单集分镜
GET    /api/studio/episodes/{ep_id}          # 获取集详情（含镜头）
PUT    /api/studio/episodes/{ep_id}          # 更新集信息
DELETE /api/studio/episodes/{ep_id}          # 删除集

# 共享元素
GET    /api/studio/series/{id}/elements      # 获取共享元素
POST   /api/studio/series/{id}/elements      # 添加共享元素
PUT    /api/studio/elements/{el_id}          # 更新共享元素
DELETE /api/studio/elements/{el_id}          # 删除共享元素

# 镜头
GET    /api/studio/episodes/{ep_id}/shots    # 获取镜头列表
PUT    /api/studio/shots/{shot_id}           # 更新镜头
POST   /api/studio/shots/{shot_id}/generate  # 生成镜头资产（图/视频/音频）
DELETE /api/studio/shots/{shot_id}           # 删除镜头

# 批量生成
POST   /api/studio/episodes/{ep_id}/batch-generate  # 批量生成（元素→帧→视频→音频）

# 设置（独立）
GET    /api/studio/settings                  # 获取工作台设置
PUT    /api/studio/settings                  # 更新工作台设置

# 导出
POST   /api/studio/episodes/{ep_id}/export   # 导出单集
POST   /api/studio/series/{id}/export        # 导出全系列
```

main.py 改动量：
- 导入 StudioService + StudioStorage
- 在 `load_saved_settings()` 中初始化 studio 服务
- 注册上述路由（约 200 行）
- 新增设置文件加载：`backend/data/studio.settings.local.yaml`

---

## Part 4：LLM 提示词 — `backend/services/studio/prompts.py`（新文件）

新建 `backend/services/studio/` 目录：

```
backend/services/studio/
├── __init__.py
├── prompts.py          # 工作台专用提示词
└── (未来可扩展)
```

### 关键提示词

**SCRIPT_SPLIT_PROMPT**：大脚本分幕拆解
```
输入完整脚本，输出分幕列表 JSON：
[{act_number, title, summary, script_excerpt, suggested_duration_seconds, key_characters}]
要求：
- 在自然的戏剧节点分幕（冲突升级、场景切换、时间跳跃）
- 每幕 script_excerpt 完整包含原文（不要遗漏）
- 每幕建议时长 60-120 秒
- 识别每幕的关键角色
```

**ELEMENT_EXTRACTION_PROMPT**：共享元素提取
```
从脚本中提取贯穿全剧的角色/场景/道具：
输出 JSON：[{name, type, description(详细视觉描述), voice_profile(角色音色), appears_in_acts}]
要求：
- description 必须可用于 AI 出图
- 角色包含外貌、年龄、服装、气质
- 场景包含时代、氛围、光线、关键元素
- voice_profile 描述音色特点（如"温柔女性，清冷"）
```

**EPISODE_PLANNING_PROMPT**：单集规划（注入系列上下文）
```
你正在为一个系列故事的第 {act_number} 集制作分镜规划。

== 系列世界观 ==
{series_bible}

== 共享角色/场景（已有，直接引用 [SE_XXX]） ==
{shared_elements_list}

== 前集摘要 ==
{prev_summary}

== 本集脚本 ==
{script_excerpt}

== 后集摘要 ==
{next_summary}

请输出本集的分镜规划 JSON...
（格式同现有 plan_project 但引用 [SE_XXX] 共享元素）
```

---

## Part 5：前端 — 最小化主项目改动 + 新建工作台页面

### 5A. 主项目改动（3处）

**`src/App.tsx`** — 添加路由入口：
```tsx
// 与 /agent/* 同级，独立页面（无侧边栏）
<Route path="studio" element={<RequireVisited><StudioPage /></RequireVisited>} />
<Route path="studio/:seriesId" element={<RequireVisited><StudioPage /></RequireVisited>} />
<Route path="studio/:seriesId/:episodeId" element={<RequireVisited><StudioPage /></RequireVisited>} />
```

**`src/pages/HomePage.tsx`** — 添加入口卡片：
```tsx
// 在 Agent 入口旁添加 Studio 入口卡片
<div onClick={() => navigate('/studio')}>
  长篇制作工作台
</div>
```

**`src/services/api.ts`** — 添加 Studio API 接口：
```tsx
// Studio API 调用函数
export async function createStudioSeries(...) { ... }
export async function listStudioSeries(...) { ... }
export async function planStudioEpisode(...) { ... }
// ... 等
```

### 5B. 新建工作台页面 `src/pages/StudioPage.tsx`

独立的全屏工作台，不依赖主项目的 Layout 组件：

```
┌─────────────────────────────────────────────────────────────┐
│ [← 返回首页]   长篇制作工作台 · 竹取物语        [⚙ 设置]    │
├────────────┬────────────────────────────────────────────────┤
│            │                                                │
│ 系列列表    │  工作区（根据选中状态切换）                      │
│            │                                                │
│ ● 竹取物语  │  [系列总览] 显示分幕列表 + 共享元素库            │
│   ├ 第1幕   │  [单集制作] 显示分镜列表 + 生成控制              │
│   ├ 第2幕   │                                                │
│   ├ 第3幕   │  ┌─────────────────────────────────────┐      │
│   ├ 第4幕   │  │ 分镜卡片网格 / 时间线视图             │      │
│   └ 第5幕   │  │                                     │      │
│            │  │  [镜头1] [镜头2] [镜头3] ...         │      │
│ 共享元素库  │  │                                     │      │
│ ├ 辉夜姬   │  └─────────────────────────────────────┘      │
│ ├ 竹取翁   │                                                │
│ ├ 银河     │  底部：音频时间线 / 预览播放器                   │
│ └ ...      │                                                │
├────────────┴────────────────────────────────────────────────┤
│ 状态栏：当前集进度 · 镜头数 · 预计时长 · 生成状态             │
└─────────────────────────────────────────────────────────────┘
```

**UI 核心视图**：

1. **系列总览视图**（选中系列根节点时）
   - 分幕卡片列表（标题、摘要、状态、时长）
   - 共享元素库面板（角色/场景卡片，含参考图）
   - Series Bible 编辑器
   - 一键"规划所有集"按钮

2. **单集制作视图**（选中某一集时）
   - 分镜卡片网格（每个卡片显示：缩略图、描述、旁白、时长、状态）
   - 右侧面板：镜头详情编辑（prompt、video_prompt、narration、dialogue）
   - 底部时间线：音频波形 + 镜头排列
   - 生成控制：逐步生成（元素图→起始帧→视频→音频）或批量生成
   - 继承的共享元素标记（带"系列共享"标签）

3. **设置面板**（独立于主项目设置）
   - LLM 模型选择（可能需要更大的 context window）
   - 图像生成模型
   - 视频生成模型
   - TTS 设置
   - 复用 `ModuleModelSwitcher` 组件

### 5C. 新建工作台 Store `src/store/studioStore.ts`

```typescript
interface StudioState {
  // 系列列表
  seriesList: StudioSeries[]
  currentSeriesId: string | null
  currentEpisodeId: string | null

  // 当前系列数据
  currentSeries: StudioSeries | null
  episodes: StudioEpisode[]
  sharedElements: StudioElement[]

  // 当前集数据
  currentEpisode: StudioEpisode | null
  shots: StudioShot[]

  // 操作
  loadSeriesList(): Promise<void>
  selectSeries(id: string): Promise<void>
  selectEpisode(id: string): Promise<void>
  createSeries(name, script, prefs): Promise<void>
  planEpisode(episodeId): Promise<void>
  // ...
}
```

---

## 关键文件清单

| 文件 | 操作 | 行数估计 | 说明 |
|------|------|---------|------|
| `backend/services/studio_storage.py` | **新建** | ~350行 | SQLite 存储层 |
| `backend/services/studio_service.py` | **新建** | ~600行 | 工作台核心服务 |
| `backend/services/studio/__init__.py` | **新建** | ~5行 | 包初始化 |
| `backend/services/studio/prompts.py` | **新建** | ~200行 | 专用 LLM 提示词 |
| `backend/main.py` | **修改** | +~200行 | 注册 studio 路由组 |
| `src/pages/StudioPage.tsx` | **新建** | ~800行 | 工作台前端页面 |
| `src/store/studioStore.ts` | **新建** | ~200行 | 工作台状态管理 |
| `src/services/api.ts` | **修改** | +~100行 | Studio API 接口 |
| `src/App.tsx` | **修改** | +~5行 | 添加路由 |
| `src/pages/HomePage.tsx` | **修改** | +~15行 | 添加入口卡片 |

### 不改动的文件（隔离保护）
- `backend/services/agent_service.py` — 不动
- `backend/services/agent/` — 不动
- `backend/services/storage_service.py` — 不动（YAML 存储保留给 Agent）
- `src/pages/AgentPage.tsx` — 不动
- 所有现有工具服务（llm/image/video/tts） — 只复用，不修改

---

## 实施顺序

1. **后端存储层**：studio_storage.py（SQLite 建表 + CRUD）
2. **后端提示词**：studio/prompts.py
3. **后端服务层**：studio_service.py（核心逻辑）
4. **后端路由**：main.py 注册 studio 路由组
5. **前端 API**：api.ts 添加 Studio 接口
6. **前端 Store**：studioStore.ts
7. **前端页面**：StudioPage.tsx
8. **主项目入口**：App.tsx + HomePage.tsx

---

## 验证方式

1. 启动后端，调用 `POST /api/studio/series` 传入竹取物语完整脚本
2. 验证 SQLite 中 series + episodes + shared_elements 表数据正确
3. 调用 `POST /api/studio/episodes/{ep_id}/plan` 为第1幕生成规划
4. 验证 shots 表中镜头数合理（8-15个）
5. 验证共享元素（辉夜姬等）被正确继承到集元素中
6. 前端访问 `/studio`，验证系列列表、分幕视图、共享元素库显示正常
7. 在主项目 `/home` 页面验证入口卡片存在且可跳转
8. 验证主项目 Agent 功能不受影响（隔离验证）

---

## 工作流示例（以竹取物语为例）

```
用户上传完整脚本（5500字，5幕）
    │
    ▼
[1] POST /api/studio/series
    ├── LLM: split_script_to_acts() → 5幕
    │   幕1: 竹林的秘密 (60s)
    │   幕2: 五位求婚者 (90s)
    │   幕3: 月之使者 (60s)
    │   幕4: 惊天反转 (90s)
    │   幕5: 新的开始 (60s)
    │
    └── LLM: extract_shared_elements() → 8个共享元素
        - SE_KAGUYA (辉夜姬, character)
        - SE_BAMBOO_ELDER (竹取翁, character)
        - SE_BAMBOO_WIFE (竹取媪, character)
        - SE_GINGA (银河, character)
        - SE_MOON_KING (月之王, character)
        - SE_ISHIGAMI (石上麻吕, character)
        - SE_BAMBOO_FOREST (竹林, scene)
        - SE_MOON_CAPITAL (月之都, scene)
    │
    ▼
[2] POST /api/studio/episodes/{ep_id}/plan  (每幕)
    ├── 注入 series_bible + 共享元素 → LLM 生成分镜规划
    ├── 每幕生成 8-15 个镜头
    └── 共享元素自动继承（同一角色描述/voice_profile）
    │
    ▼
[3] 用户在 StudioPage 中逐集精修
    ├── 使用 enhance_episode() 增强分镜
    ├── 生成元素图（共享元素只需生成一次，跨集复用 image_url）
    ├── 生成起始帧 + 视频
    └── 最终导出
```
