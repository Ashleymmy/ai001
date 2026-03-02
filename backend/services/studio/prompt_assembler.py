"""Studio 提示词取词组装引擎 — Phase 1

将知识库（kb_character_cards, kb_scene_cards, kb_mood_packs, kb_world_bible）
中的结构化 tokens 组装为最终提示词片段，替代 Phase 0 简单的 [SE_XXX] 文本替换。

核心流程：
  1. assemble_character_tokens() — 从角色档案取词
  2. assemble_scene_tokens()     — 从场景档案取词
  3. inject_mood()               — 注入情绪氛围包
  4. inject_cinematography()     — 注入镜头语言词条
  5. inject_world_constraints()  — 注入世界观约束（art_style / forbidden）
  6. assemble_shot_prompt()      — 单格完整提示词组装
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

from .knowledge_base import KnowledgeBase
from .mood_packs import (
    BUILTIN_MOOD_PACKS,
    ZH_MOOD_ALIASES,
    get_mood_visual_prompt,
)
from .constants import (
    SHOT_SIZE_STANDARDS,
    CAMERA_ANGLES,
    CAMERA_MOVEMENTS,
    DEFAULT_NEGATIVE_PROMPT,
)


class PromptAssembler:
    """提示词取词组装引擎。

    实例化时接收 KnowledgeBase（已持有 StudioStorage）和可选参数。
    所有方法均为同步调用，可在同步或异步上下文中使用。
    """

    def __init__(
        self,
        kb: KnowledgeBase,
        *,
        default_style: str = "",
    ) -> None:
        self.kb = kb
        self.storage = kb.storage
        self.default_style = default_style

    # ==================================================================
    # 1. 角色 token 组装
    # ==================================================================

    def assemble_character_tokens(
        self,
        element_id: str,
        costume_key: str = "default",
        expression_key: str = "neutral",
    ) -> str:
        """从角色档案取词，返回可直接注入提示词的 token 字符串。

        如果知识库中没有该角色的卡片，回退到 shared_elements 原始描述。
        """
        tokens = self.kb.get_character_prompt_tokens(
            element_id,
            costume_key=costume_key,
            expression_key=expression_key,
        )
        if tokens:
            return tokens

        # 回退：直接使用 shared_elements 描述
        element = self.storage.get_shared_element(element_id)
        if element:
            return str(element.get("description") or "")
        return ""

    # ==================================================================
    # 2. 场景 token 组装
    # ==================================================================

    def assemble_scene_tokens(
        self,
        element_id: str,
        time_variant: str = "day",
    ) -> str:
        """从场景档案取词，返回可直接注入提示词的 token 字符串。"""
        tokens = self.kb.get_scene_prompt_tokens(element_id, time_variant=time_variant)
        if tokens:
            return tokens

        element = self.storage.get_shared_element(element_id)
        if element:
            return str(element.get("description") or "")
        return ""

    # ==================================================================
    # 3. 情绪氛围注入
    # ==================================================================

    def inject_mood(
        self,
        mood_key: str,
        series_id: str = "",
    ) -> str:
        """根据 mood_key（支持中文别名）返回情绪氛围 combined_prompt。

        查询优先级：
        1. KB 表 kb_mood_packs（系列专属自定义）
        2. mood_packs.py 的内置 BUILTIN_MOOD_PACKS
        """
        # 先尝试通过 KB 层（查询 kb_mood_packs 表）
        kb_prompt = self.kb.get_mood_pack(mood_key, series_id=series_id or None)
        if kb_prompt:
            return kb_prompt

        # 回退到 mood_packs.py 内置包（支持中文别名）
        return get_mood_visual_prompt(mood_key, series_id=series_id)

    # ==================================================================
    # 4. 镜头语言注入（从 Phase 0 迁移并增强）
    # ==================================================================

    def inject_cinematography(self, shot: Dict[str, Any]) -> str:
        """从 shot 字段中提取景别/机位/运镜的英文词条，组装为提示词片段。

        对标 studio_service._get_cinematography_en 但增加了更多上下文。
        """
        parts: List[str] = []

        shot_size = str(shot.get("shot_size") or "").strip()
        camera_angle = str(shot.get("camera_angle") or "").strip()
        camera_movement = str(shot.get("camera_movement") or "").strip()

        if shot_size:
            entry = SHOT_SIZE_STANDARDS.get(shot_size)
            parts.append(entry["en"] if entry else shot_size)

        if camera_angle:
            entry = CAMERA_ANGLES.get(camera_angle)
            parts.append(entry["en"] if entry else camera_angle)

        if camera_movement:
            entry = CAMERA_MOVEMENTS.get(camera_movement)
            parts.append(entry["en"] if entry else camera_movement)

        return ", ".join(parts)

    # ==================================================================
    # 5. 世界观约束注入
    # ==================================================================

    def inject_world_constraints(self, series_id: str) -> Dict[str, str]:
        """返回世界观约束信息，供外层拼入系统提示词或负面提示词。

        Returns:
            {
                "style_prompt": "art_style + era + palette + motifs",
                "negative_prompt": "forbidden_elements + 默认负面词",
            }
        """
        constraints = self.kb.get_world_bible_constraints(series_id)
        style_parts: List[str] = []
        for key in ("art_style", "era", "color_palette", "recurring_motifs"):
            val = constraints.get(key, "")
            if val:
                style_parts.append(val)

        forbidden = constraints.get("forbidden_elements", "")
        neg_parts = [DEFAULT_NEGATIVE_PROMPT]
        if forbidden:
            neg_parts.append(forbidden)

        return {
            "style_prompt": ", ".join(style_parts),
            "negative_prompt": ", ".join(neg_parts),
        }

    # ==================================================================
    # 6. [SE_XXX] 引用替换（增强版）
    # ==================================================================

    _SE_REF_PATTERN = re.compile(r"\[(SE_[a-zA-Z0-9_]+)\]")

    def resolve_element_refs(
        self,
        text: str,
        series_id: str,
        *,
        use_kb: bool = True,
        costume_key: str = "default",
        expression_key: str = "neutral",
        time_variant: str = "day",
    ) -> str:
        """将 [SE_XXX] 引用替换为知识库结构化 tokens（或回退到原始描述）。

        当 use_kb=True 时，角色引用会经过 assemble_character_tokens，
        场景引用会经过 assemble_scene_tokens。
        """
        if not text:
            return text

        elements = self.storage.get_shared_elements(series_id)
        id_to_element: Dict[str, Dict[str, Any]] = {el["id"]: el for el in elements}

        def replacer(m: re.Match) -> str:
            eid = m.group(1)
            elem = id_to_element.get(eid)
            if not elem:
                return m.group(0)

            if not use_kb:
                return str(elem.get("description") or m.group(0))

            etype = str(elem.get("type") or "")
            if etype == "character":
                tokens = self.assemble_character_tokens(
                    eid,
                    costume_key=costume_key,
                    expression_key=expression_key,
                )
                return tokens or str(elem.get("description") or m.group(0))
            elif etype == "scene":
                tokens = self.assemble_scene_tokens(eid, time_variant=time_variant)
                return tokens or str(elem.get("description") or m.group(0))
            else:
                return str(elem.get("description") or m.group(0))

        return self._SE_REF_PATTERN.sub(replacer, text)

    # ==================================================================
    # 7. 完整单格提示词组装
    # ==================================================================

    def assemble_shot_prompt(
        self,
        shot: Dict[str, Any],
        series_id: str,
        *,
        prompt_field: str = "prompt",
        stage: str = "start_frame",
        costume_key: str = "default",
        expression_key: str = "neutral",
        time_variant: str = "day",
    ) -> Dict[str, str]:
        """为单个镜头组装完整提示词。

        Args:
            shot: 镜头 dict（含 prompt, shot_size, emotion 等字段）
            series_id: 所属系列 ID
            prompt_field: 使用哪个字段作为基础提示词 ("prompt"/"key_frame_prompt"/"end_prompt")
            stage: 帧阶段 ("start_frame"/"key_frame"/"end_frame")
            costume_key: 角色服装变体
            expression_key: 角色表情变体
            time_variant: 场景时段变体

        Returns:
            {
                "prompt": 组装后的完整正向提示词,
                "negative_prompt": 组装后的负面提示词,
                "style_prompt": 世界观风格提示词,
                "cinematography": 镜头语言词条,
                "mood_prompt": 情绪氛围词条,
            }
        """
        raw_prompt = str(shot.get(prompt_field) or shot.get("prompt") or "").strip()

        # Step 1: 替换 [SE_XXX] 引用
        resolved = self.resolve_element_refs(
            raw_prompt,
            series_id,
            use_kb=True,
            costume_key=costume_key,
            expression_key=expression_key,
            time_variant=time_variant,
        )

        # Step 2: 镜头语言
        cinematography = self.inject_cinematography(shot)

        # Step 3: 情绪氛围
        emotion = str(shot.get("emotion") or "").strip()
        mood_prompt = ""
        if emotion:
            mood_prompt = self.inject_mood(emotion, series_id=series_id)

        # Step 4: 世界观约束
        world = self.inject_world_constraints(series_id)
        style_prompt = world["style_prompt"] or self.default_style
        negative_prompt = world["negative_prompt"]

        # Step 5: 组装最终正向提示词
        prompt_parts: List[str] = []
        if style_prompt:
            prompt_parts.append(style_prompt)
        if resolved:
            prompt_parts.append(resolved)
        if cinematography:
            prompt_parts.append(cinematography)
        if mood_prompt:
            prompt_parts.append(mood_prompt)

        final_prompt = ", ".join(p for p in prompt_parts if p)

        return {
            "prompt": final_prompt,
            "negative_prompt": negative_prompt,
            "style_prompt": style_prompt,
            "cinematography": cinematography,
            "mood_prompt": mood_prompt,
        }
