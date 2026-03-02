"""Studio 知识库 - 角色/场景/情绪/世界观 提示词管理层

从 shared_elements 同步角色和场景描述，解析为结构化提示词 tokens，
供 prompt_assembler 在出图时注入。
"""
import json
import re
from typing import Optional, Dict, Any, List

# ---------------------------------------------------------------------------
# 中文 -> 英文 外观词映射（常见漫画/动画角色描述用语）
# ---------------------------------------------------------------------------

_ZH_EN_HAIR = {
    "黑色": "black", "白色": "white", "金色": "golden", "银色": "silver",
    "蓝色": "blue", "红色": "red", "粉色": "pink", "紫色": "purple",
    "绿色": "green", "棕色": "brown", "灰色": "gray", "橙色": "orange",
    "长发": "long hair", "短发": "short hair", "马尾": "ponytail",
    "双马尾": "twintails", "卷发": "curly hair", "直发": "straight hair",
    "刘海": "bangs", "辫子": "braid", "丸子头": "hair bun",
    "披肩发": "shoulder-length hair", "齐肩发": "shoulder-length hair",
    "中长发": "medium hair", "寸头": "buzz cut", "光头": "bald",
}

_ZH_EN_EYES = {
    "黑色": "black", "蓝色": "blue", "红色": "red", "绿色": "green",
    "金色": "golden", "紫色": "purple", "棕色": "brown", "银色": "silver",
    "异色瞳": "heterochromia", "大眼睛": "big eyes", "细长眼": "narrow eyes",
    "圆眼": "round eyes",
}

_ZH_EN_BUILD = {
    "高大": "tall", "矮小": "short", "瘦": "slim", "壮": "muscular",
    "苗条": "slender", "健壮": "athletic", "丰满": "plump",
    "娇小": "petite", "魁梧": "burly", "纤细": "slender",
}

_ZH_EN_SKIN = {
    "白皙": "fair skin", "小麦色": "tanned skin", "古铜色": "bronze skin",
    "黝黑": "dark skin", "苍白": "pale skin",
}

_ZH_EN_COSTUME = {
    "铠甲": "armor", "白色铠甲": "white armor", "黑色铠甲": "black armor",
    "学生服": "school uniform", "校服": "school uniform",
    "西装": "suit", "连衣裙": "dress", "和服": "kimono",
    "斗篷": "cloak", "长袍": "robe", "战甲": "battle armor",
    "制服": "uniform", "休闲装": "casual wear", "便装": "casual wear",
    "战斗服": "battle outfit", "礼服": "formal dress",
    "围裙": "apron", "运动装": "sportswear",
}

_ZH_EN_SCENE = {
    "城市": "city", "森林": "forest", "海边": "seaside", "沙漠": "desert",
    "山脉": "mountains", "宫殿": "palace", "城堡": "castle",
    "学校": "school", "教室": "classroom", "街道": "street",
    "夜空": "night sky", "花园": "garden", "废墟": "ruins",
    "洞穴": "cave", "太空": "space", "战场": "battlefield",
    "酒馆": "tavern", "码头": "harbor", "神殿": "temple",
    "室内": "indoor", "室外": "outdoor",
}


def _zh_to_en(text: str, mapping: Dict[str, str]) -> str:
    """将中文词汇替换为英文。"""
    result = text
    for zh, en in sorted(mapping.items(), key=lambda x: -len(x[0])):
        result = result.replace(zh, en)
    return result.strip()


def _split_desc(text: str) -> List[str]:
    """将中文描述按常见分隔符切分为短语列表。"""
    parts = re.split(r"[，,。；;、\n]+", text)
    return [p.strip() for p in parts if p.strip()]


class KnowledgeBase:
    """知识库高级操作层 - 连接 shared_elements 与 KB 提示词卡片。"""

    def __init__(self, storage: Any):
        """
        Args:
            storage: StudioStorage 实例
        """
        self.storage = storage

    # ------------------------------------------------------------------
    # 角色同步
    # ------------------------------------------------------------------

    def sync_character_from_element(self, element_id: str) -> Optional[Dict[str, Any]]:
        """从 shared_elements 的角色描述解析出结构化外观 tokens 并写入 kb_character_cards。"""
        element = self.storage.get_shared_element(element_id)
        if not element:
            return None
        if element.get("type") != "character":
            return None

        description = str(element.get("description") or "")
        name = str(element.get("name") or "")

        appearance_tokens = self._parse_character_appearance(description)
        costume_tokens = self._parse_character_costume(description)
        expression_tokens = self._build_default_expressions()
        signature_poses = self._build_default_poses()

        existing = self.storage.get_character_card_by_element(element_id)
        if existing:
            new_version = int(existing.get("version", 1)) + 1
            self.storage.update_character_card(existing["id"], {
                "appearance_tokens": appearance_tokens,
                "costume_tokens": costume_tokens,
                "expression_tokens": expression_tokens,
                "signature_poses": signature_poses,
                "version": new_version,
            })
            return self.storage.get_character_card(existing["id"])
        else:
            return self.storage.create_character_card(
                element_id=element_id,
                appearance_tokens=appearance_tokens,
                costume_tokens=costume_tokens,
                expression_tokens=expression_tokens,
                signature_poses=signature_poses,
            )

    def _parse_character_appearance(self, description: str) -> Dict[str, str]:
        """从描述文本中提取外观 tokens (hair, eyes, skin, build)。"""
        tokens: Dict[str, str] = {}
        phrases = _split_desc(description)

        hair_keywords = list(_ZH_EN_HAIR.keys())
        eye_keywords = list(_ZH_EN_EYES.keys())
        skin_keywords = list(_ZH_EN_SKIN.keys())
        build_keywords = list(_ZH_EN_BUILD.keys())

        hair_parts: List[str] = []
        eye_parts: List[str] = []
        skin_parts: List[str] = []
        build_parts: List[str] = []

        for phrase in phrases:
            matched = False
            if any(kw in phrase for kw in ["发", "头发", "hair"]):
                hair_parts.append(_zh_to_en(phrase, _ZH_EN_HAIR))
                matched = True
            elif any(kw in phrase for kw in hair_keywords if kw.endswith("发")):
                hair_parts.append(_zh_to_en(phrase, _ZH_EN_HAIR))
                matched = True

            if any(kw in phrase for kw in ["眼", "瞳", "eye"]):
                eye_parts.append(_zh_to_en(phrase, _ZH_EN_EYES))
                matched = True

            if any(kw in phrase for kw in ["肤", "皮肤", "skin"]):
                skin_parts.append(_zh_to_en(phrase, _ZH_EN_SKIN))
                matched = True
            elif any(kw in phrase for kw in skin_keywords):
                skin_parts.append(_zh_to_en(phrase, _ZH_EN_SKIN))
                matched = True

            if any(kw in phrase for kw in build_keywords):
                build_parts.append(_zh_to_en(phrase, _ZH_EN_BUILD))
                matched = True

            if not matched:
                # Check for hair color keywords without hair-specific suffix
                for kw in hair_keywords:
                    if kw in phrase and ("色" in kw or "发" in kw):
                        hair_parts.append(_zh_to_en(phrase, _ZH_EN_HAIR))
                        break

        tokens["hair"] = ", ".join(hair_parts) if hair_parts else "black hair"
        tokens["eyes"] = ", ".join(eye_parts) if eye_parts else "dark eyes"
        tokens["skin"] = ", ".join(skin_parts) if skin_parts else "fair skin"
        tokens["build"] = ", ".join(build_parts) if build_parts else "average build"

        return tokens

    def _parse_character_costume(self, description: str) -> Dict[str, str]:
        """从描述中提取服装 tokens。"""
        tokens: Dict[str, str] = {"default": ""}
        phrases = _split_desc(description)

        costume_parts: List[str] = []
        costume_keywords = list(_ZH_EN_COSTUME.keys()) + [
            "穿", "戴", "身着", "服", "装", "衣", "裙", "裤",
        ]

        for phrase in phrases:
            if any(kw in phrase for kw in costume_keywords):
                costume_parts.append(_zh_to_en(phrase, _ZH_EN_COSTUME))

        tokens["default"] = ", ".join(costume_parts) if costume_parts else "default outfit"
        return tokens

    @staticmethod
    def _build_default_expressions() -> Dict[str, str]:
        """返回一组默认表情 tokens。"""
        return {
            "neutral": "neutral expression",
            "happy": "smiling, happy expression",
            "sad": "sad expression, downcast eyes",
            "angry": "angry expression, furrowed brows",
            "surprised": "surprised expression, wide eyes",
            "determined": "determined expression, intense gaze",
        }

    @staticmethod
    def _build_default_poses() -> Dict[str, str]:
        """返回一组默认姿势 tokens。"""
        return {
            "idle": "standing pose",
            "action": "dynamic action pose",
            "sitting": "sitting pose",
            "battle": "battle stance",
        }

    # ------------------------------------------------------------------
    # 场景同步
    # ------------------------------------------------------------------

    def sync_scene_from_element(self, element_id: str) -> Optional[Dict[str, Any]]:
        """从 shared_elements 的场景描述解析出结构化场景 tokens。"""
        element = self.storage.get_shared_element(element_id)
        if not element:
            return None
        if element.get("type") != "scene":
            return None

        description = str(element.get("description") or "")

        base_tokens = self._parse_scene_base(description)
        time_variants = self._build_scene_time_variants(base_tokens)

        existing = self.storage.get_scene_card_by_element(element_id)
        if existing:
            new_version = int(existing.get("version", 1)) + 1
            self.storage.update_scene_card(existing["id"], {
                "base_tokens": base_tokens,
                "time_variants": time_variants,
                "version": new_version,
            })
            return self.storage.get_scene_card(existing["id"])
        else:
            return self.storage.create_scene_card(
                element_id=element_id,
                base_tokens=base_tokens,
                time_variants=time_variants,
            )

    def _parse_scene_base(self, description: str) -> str:
        """从场景描述提取基础空间 tokens。"""
        phrases = _split_desc(description)
        en_parts: List[str] = []
        for phrase in phrases:
            translated = _zh_to_en(phrase, _ZH_EN_SCENE)
            en_parts.append(translated)
        return ", ".join(en_parts) if en_parts else "detailed background"

    @staticmethod
    def _build_scene_time_variants(base_tokens: str) -> Dict[str, str]:
        """基于 base_tokens 生成不同时段变体。"""
        return {
            "day": f"{base_tokens}, daytime, bright natural lighting",
            "night": f"{base_tokens}, nighttime, moonlight, dark atmosphere",
            "sunset": f"{base_tokens}, sunset, golden hour, warm orange light",
            "rain": f"{base_tokens}, rainy weather, wet surfaces, overcast sky",
            "dawn": f"{base_tokens}, dawn, soft morning light, misty",
        }

    # ------------------------------------------------------------------
    # 批量同步
    # ------------------------------------------------------------------

    def sync_all_elements(self, series_id: str) -> Dict[str, int]:
        """批量同步系列下所有角色和场景元素到知识库。"""
        elements = self.storage.get_shared_elements(series_id)
        synced = {"characters": 0, "scenes": 0}
        for elem in elements:
            etype = elem.get("type", "")
            eid = elem.get("id", "")
            if etype == "character":
                result = self.sync_character_from_element(eid)
                if result:
                    synced["characters"] += 1
            elif etype == "scene":
                result = self.sync_scene_from_element(eid)
                if result:
                    synced["scenes"] += 1
        return synced

    # ------------------------------------------------------------------
    # 提示词取词
    # ------------------------------------------------------------------

    def get_character_prompt_tokens(
        self,
        element_id: str,
        costume_key: str = "default",
        expression_key: str = "neutral",
    ) -> str:
        """为指定角色元素组装提示词 token 字符串。"""
        card = self.storage.get_character_card_by_element(element_id)
        if not card:
            return ""

        parts: List[str] = []

        appearance = card.get("appearance_tokens")
        if isinstance(appearance, dict):
            for v in appearance.values():
                if v:
                    parts.append(str(v))
        elif isinstance(appearance, str) and appearance:
            parts.append(appearance)

        costumes = card.get("costume_tokens")
        if isinstance(costumes, dict):
            costume = costumes.get(costume_key) or costumes.get("default", "")
            if costume:
                parts.append(str(costume))
        elif isinstance(costumes, str) and costumes:
            parts.append(costumes)

        expressions = card.get("expression_tokens")
        if isinstance(expressions, dict):
            expr = expressions.get(expression_key) or expressions.get("neutral", "")
            if expr:
                parts.append(str(expr))
        elif isinstance(expressions, str) and expressions:
            parts.append(expressions)

        return ", ".join(parts)

    def get_scene_prompt_tokens(
        self,
        element_id: str,
        time_variant: str = "day",
    ) -> str:
        """为指定场景元素返回对应时段的提示词 tokens。"""
        card = self.storage.get_scene_card_by_element(element_id)
        if not card:
            return ""

        time_variants = card.get("time_variants")
        if isinstance(time_variants, dict):
            variant = time_variants.get(time_variant)
            if variant:
                return str(variant)

        base = str(card.get("base_tokens") or "")
        return base

    def get_mood_pack(
        self,
        mood_key: str,
        series_id: Optional[str] = None,
    ) -> str:
        """获取指定情绪氛围的 combined_prompt。优先返回系列专属包，否则返回内置包。"""
        if series_id:
            packs = self.storage.get_mood_packs_by_series(series_id, mood_key=mood_key)
        else:
            packs = self.storage.list_mood_packs()
            packs = [p for p in packs if p.get("mood_key") == mood_key]

        if not packs:
            return ""

        # Prefer series-specific non-builtin, then builtin
        for pack in packs:
            sid = pack.get("series_id", "")
            if series_id and sid == series_id and not pack.get("is_builtin"):
                return str(pack.get("combined_prompt") or "")
        # Fallback to first match
        return str(packs[0].get("combined_prompt") or "")

    def get_world_bible_constraints(self, series_id: str) -> Dict[str, str]:
        """获取世界观约束：art_style + forbidden_elements。"""
        bible = self.storage.get_world_bible_by_series(series_id)
        if not bible:
            return {"art_style": "", "forbidden_elements": ""}
        return {
            "art_style": str(bible.get("art_style") or ""),
            "forbidden_elements": str(bible.get("forbidden_elements") or ""),
            "era": str(bible.get("era") or ""),
            "color_palette": str(bible.get("color_palette") or ""),
            "recurring_motifs": str(bible.get("recurring_motifs") or ""),
        }
