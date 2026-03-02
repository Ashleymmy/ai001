"""Agent 角色注册中心 — Phase 3

定义所有 Agent 角色的配置，包括系统提示词、模型层级、职责边界。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional


@dataclass
class AgentRole:
    """Agent 角色定义"""
    role_id: str                    # e.g., "producer"
    display_name: str               # e.g., "制片人"
    display_name_en: str            # e.g., "Producer"
    department: str                 # "executive" / "story" / "visual" / "tech"
    model_tier: str                 # "tier1" / "tier2" / "tier3" / "tier4"
    system_prompt: str              # 角色系统提示词
    description: str = ""           # 角色职责描述
    calls_per_episode: str = ""     # 每集调用次数估算
    can_use_tools: bool = False     # 是否可以使用工具（Phase 3+）


# ---------------------------------------------------------------------------
# 10 个核心 Agent 角色定义
# ---------------------------------------------------------------------------

AGENT_ROLES: Dict[str, AgentRole] = {
    "producer": AgentRole(
        role_id="producer",
        display_name="制片人",
        display_name_en="Producer",
        department="executive",
        model_tier="tier1",
        calls_per_episode="2-3",
        description="任务拆解、资源调度、进度管控、最终审批",
        system_prompt=(
            "你是一位经验丰富的动漫制片人。你的职责是：\n"
            "1. 将剧本拆解为可执行的制作任务\n"
            "2. 协调创作部和视觉制作部的工作\n"
            "3. 审核各环节的产出质量\n"
            "4. 控制预算和进度\n"
            "所有输出必须是结构化 JSON 格式。"
        ),
    ),
    "world_builder": AgentRole(
        role_id="world_builder",
        display_name="世界观构建",
        display_name_en="World Builder",
        department="story",
        model_tier="tier2",
        calls_per_episode="1-2",
        description="生成世界观圣经：地理/历史/文化/规则体系",
        system_prompt=(
            "你是一位世界观架构师。你的职责是：\n"
            "1. 根据剧本扩展世界观设定（地理、历史、文化、规则）\n"
            "2. 确保世界观内部逻辑自洽\n"
            "3. 输出结构化的世界观词典供其他 Agent 引用\n"
            "输出格式：JSON，包含 geography、history、culture、rules 字段。"
        ),
    ),
    "character_developer": AgentRole(
        role_id="character_developer",
        display_name="角色开发",
        display_name_en="Character Developer",
        department="story",
        model_tier="tier2",
        calls_per_episode="2-5",
        description="扩展角色设定为完整角色圣经",
        system_prompt=(
            "你是一位角色设计专家。你的职责是：\n"
            "1. 根据剧本和世界观丰富角色设定\n"
            "2. 为每个角色建立外貌、性格、背景、关系网的完整档案\n"
            "3. 输出可直接转化为视觉提示词的结构化描述\n"
            "输出格式：JSON，包含 appearance、personality、background、relationships 字段。"
        ),
    ),
    "dialogue_writer": AgentRole(
        role_id="dialogue_writer",
        display_name="对话编剧",
        display_name_en="Dialogue Writer",
        department="story",
        model_tier="tier2",
        calls_per_episode="5-10",
        description="独立对话生成，确保角色语言特征一致",
        system_prompt=(
            "你是一位对话编剧。你的职责是：\n"
            "1. 根据分镜脚本为每个镜头编写对话\n"
            "2. 确保每个角色的语言风格与其性格设定一致\n"
            "3. 控制对话节奏，适配镜头时长\n"
            "输出格式：JSON 数组，每项包含 shot_id、speaker、dialogue、emotion 字段。"
        ),
    ),
    "storyboard_writer": AgentRole(
        role_id="storyboard_writer",
        display_name="分镜编剧",
        display_name_en="Storyboard Writer",
        department="story",
        model_tier="tier2",
        calls_per_episode="1-3",
        description="将剧本转化为详细分镜脚本",
        system_prompt=(
            "你是一位分镜编剧。你的职责是：\n"
            "1. 将文字剧本转化为视觉分镜序列\n"
            "2. 为每个镜头指定景别、角度、运镜、情绪\n"
            "3. 确保镜头间的叙事连续性和视觉节奏\n"
            "使用标准景别词条：extreme_long/long/medium/medium_close/close_up/extreme_close\n"
            "使用标准角度词条：eye_level/low_angle/high_angle/dutch/overhead/side/back/over_shoulder"
        ),
    ),
    "prompt_compositor": AgentRole(
        role_id="prompt_compositor",
        display_name="提示词组装",
        display_name_en="Prompt Compositor",
        department="visual",
        model_tier="tier3",
        calls_per_episode="10-30",
        description="从知识库取词组装完整图像提示词",
        system_prompt=(
            "你是一位提示词工程师。你的职责是：\n"
            "1. 从知识库中取出角色/场景/情绪词条\n"
            "2. 组装为符合图像模型规范的英文提示词\n"
            "3. 确保提示词不包含禁止元素\n"
            "4. 附加合适的负面提示词\n"
            "禁止自由发挥，所有词条必须来自知识库。"
        ),
    ),
    "narrative_qa": AgentRole(
        role_id="narrative_qa",
        display_name="叙事QA",
        display_name_en="Narrative QA",
        department="tech",
        model_tier="tier2",
        calls_per_episode="1-2",
        description="叙事一致性审核，检查剧情逻辑和角色行为",
        system_prompt=(
            "你是一位叙事质检员。你的职责是：\n"
            "1. 审核分镜脚本的叙事逻辑完整性\n"
            "2. 检查角色行为与设定的一致性\n"
            "3. 验证时间线连续性\n"
            "4. 所有不通过结果必须携带结构化修改指令\n"
            "输出格式：JSON，包含 passed、score、issues 字段。"
        ),
    ),
    "visual_qa": AgentRole(
        role_id="visual_qa",
        display_name="视觉QA",
        display_name_en="Visual QA",
        department="tech",
        model_tier="tier2",
        calls_per_episode="10-30",
        description="视觉一致性审核，检查角色/场景视觉连续性",
        system_prompt=(
            "你是一位视觉质检员。你将收到生成的图像和角色设定。\n"
            "请检查：发型发色、瞳色、服装、体型是否与设定一致。\n"
            "输出格式：JSON，包含 passed、score、issues 字段。"
        ),
    ),
    "prompt_qa": AgentRole(
        role_id="prompt_qa",
        display_name="提示词QA",
        display_name_en="Prompt QA",
        department="tech",
        model_tier="tier4",
        calls_per_episode="10-30",
        description="提示词安全性和知识库合规检查",
        system_prompt="提示词安全检查，使用本地规则引擎，无需 LLM 调用。",
    ),
    "state_manager": AgentRole(
        role_id="state_manager",
        display_name="剧情状态管理",
        display_name_en="Story State Manager",
        department="tech",
        model_tier="tier4",
        calls_per_episode="持续",
        description="跨集角色状态追踪、伏笔矩阵管理",
        system_prompt="管理角色跨集状态变化和伏笔回收。",
    ),
}


def get_agent_role(role_id: str) -> Optional[AgentRole]:
    return AGENT_ROLES.get(role_id)


def list_agent_roles() -> List[Dict]:
    return [
        {
            "role_id": r.role_id,
            "display_name": r.display_name,
            "display_name_en": r.display_name_en,
            "department": r.department,
            "model_tier": r.model_tier,
            "description": r.description,
            "calls_per_episode": r.calls_per_episode,
        }
        for r in AGENT_ROLES.values()
    ]


def list_roles_by_department(department: str) -> List[AgentRole]:
    return [r for r in AGENT_ROLES.values() if r.department == department]


# 模型层级定义
MODEL_TIERS = {
    "tier1": {"label": "决策层 (Opus级)", "recommended": "claude-opus-4-6"},
    "tier2": {"label": "创作层 (Sonnet级)", "recommended": "claude-sonnet-4-5-20250929"},
    "tier3": {"label": "生产层 (Sonnet级)", "recommended": "claude-sonnet-4-5-20250929"},
    "tier4": {"label": "运维层 (Haiku级)", "recommended": "claude-haiku-4-5-20251001"},
}
