"""Studio 长篇制作工作台 - 核心服务层

独立于 Agent 模块，复用工具服务类（LLMService / ImageService / VideoService / TTSService），
拥有自己的实例和配置。
"""
import json
import math
import re
from typing import Any, Dict, List, Optional

from .studio_storage import StudioStorage
from .studio.prompts import (
    SCRIPT_SPLIT_SYSTEM_PROMPT,
    SCRIPT_SPLIT_PROMPT,
    ELEMENT_EXTRACTION_SYSTEM_PROMPT,
    ELEMENT_EXTRACTION_PROMPT,
    EPISODE_PLANNING_SYSTEM_PROMPT,
    EPISODE_PLANNING_PROMPT,
    EPISODE_ENHANCE_SYSTEM_PROMPT,
    EPISODE_ENHANCE_PROMPT,
)
from .llm_service import LLMService
from .image_service import ImageService
from .video_service import VideoService
from .tts_service import VolcTTSService, VolcTTSConfig


class StudioServiceError(Exception):
    """Studio 结构化业务错误。"""

    def __init__(
        self,
        message: str,
        error_code: str = "studio_error",
        context: Optional[Dict[str, Any]] = None,
    ):
        super().__init__(message)
        self.message = message
        self.error_code = error_code
        self.context = context or {}

    def to_payload(self) -> Dict[str, Any]:
        payload: Dict[str, Any] = {
            "detail": self.message,
            "error_code": self.error_code,
        }
        if self.context:
            payload["context"] = self.context
        return payload


class StudioService:
    """长篇制作工作台核心服务"""

    def __init__(self, storage: StudioStorage):
        self.storage = storage
        # 工具服务实例（独立于 Agent / Module）
        self.llm: Optional[LLMService] = None
        self.image: Optional[ImageService] = None
        self.video: Optional[VideoService] = None
        self.tts: Optional[VolcTTSService] = None
        self.generation_defaults: Dict[str, Any] = {}

    # ------------------------------------------------------------------
    # 配置
    # ------------------------------------------------------------------

    def configure(self, settings: Dict[str, Any]) -> None:
        """从设置字典中初始化工具服务实例"""
        # 每次重配都先清空，避免沿用旧实例
        self.llm = None
        self.image = None
        self.video = None
        self.tts = None

        # LLM
        llm_cfg = settings.get("llm") or {}
        if llm_cfg.get("apiKey"):
            self.llm = LLMService(
                provider=llm_cfg.get("provider", "qwen"),
                api_key=llm_cfg["apiKey"],
                base_url=llm_cfg.get("baseUrl"),
                model=llm_cfg.get("model"),
            )
            print(f"[Studio] LLM 已配置: {llm_cfg.get('provider')}/{llm_cfg.get('model')}")

        # Image
        img_cfg = settings.get("image") or {}
        if img_cfg.get("provider"):
            self.image = ImageService(
                provider=img_cfg["provider"],
                api_key=img_cfg.get("apiKey", ""),
                base_url=img_cfg.get("baseUrl", ""),
                model=img_cfg.get("model", ""),
            )

        # Video
        vid_cfg = settings.get("video") or {}
        if vid_cfg.get("provider"):
            self.video = VideoService(
                provider=vid_cfg["provider"],
                api_key=vid_cfg.get("apiKey", ""),
                base_url=vid_cfg.get("baseUrl", ""),
                model=vid_cfg.get("model", ""),
            )

        # TTS
        tts_cfg = settings.get("tts") or {}
        if tts_cfg.get("appid") and tts_cfg.get("accessToken"):
            config = VolcTTSConfig(
                appid=tts_cfg["appid"],
                access_token=tts_cfg["accessToken"],
                cluster=tts_cfg.get("cluster", "volcano_tts"),
            )
            self.tts = VolcTTSService(config)

        # 生成默认参数
        self.generation_defaults = settings.get("generation_defaults") or {}

    def check_config(self) -> Dict[str, Any]:
        """返回 Studio 工具链配置自检结果。"""
        services = {
            "llm": {
                "configured": self.llm is not None,
                "message": "" if self.llm else "请先在设置中配置 LLM 服务",
            },
            "image": {
                "configured": self.image is not None,
                "message": "" if self.image else "请先在设置中配置图像服务",
            },
            "video": {
                "configured": self.video is not None,
                "message": "" if self.video else "请先在设置中配置视频服务",
            },
            "tts": {
                "configured": self.tts is not None,
                "message": "" if self.tts else "请先在设置中配置 TTS 服务",
            },
        }
        return {
            "ok": all(v["configured"] for v in services.values()),
            "services": services,
        }

    # ------------------------------------------------------------------
    # 内部工具
    # ------------------------------------------------------------------

    @staticmethod
    def _extract_json(reply: str) -> Optional[Any]:
        """从 LLM 回复中提取 JSON（支持 ```json 代码块 / 裸 JSON）"""
        if not reply or not reply.strip():
            return None

        def try_load(raw: str) -> Optional[Any]:
            s = raw.strip().lstrip("\ufeff")
            if not s:
                return None
            try:
                return json.loads(s)
            except Exception:
                pass
            # 智能引号修复
            s = (
                s.replace("\u201c", '"').replace("\u201d", '"')
                .replace("\u201e", '"').replace("\u201f", '"')
                .replace("\u2018", "'").replace("\u2019", "'")
            )
            # 移除尾部逗号
            s = re.sub(r",\s*([}\]])", r"\1", s)
            try:
                return json.loads(s)
            except Exception:
                pass
            return None

        # 1) ```json ... ```
        m = re.search(r"```(?:json|JSON)\s*([\s\S]*?)\s*```", reply)
        if m:
            data = try_load(m.group(1))
            if data is not None:
                return data

        # 2) ``` ... ```
        m = re.search(r"```\s*([\s\S]*?)\s*```", reply)
        if m:
            data = try_load(m.group(1))
            if data is not None:
                return data

        # 3) 直接尝试整体解析
        data = try_load(reply)
        if data is not None:
            return data

        # 4) 寻找最外层 { } 或 [ ]
        for opener, closer in [("{", "}"), ("[", "]")]:
            start = reply.find(opener)
            end = reply.rfind(closer)
            if start != -1 and end > start:
                data = try_load(reply[start : end + 1])
                if data is not None:
                    return data

        return None

    async def _llm_call(
        self,
        user_prompt: str,
        system_prompt: str = "",
        max_tokens: int = 8000,
        temperature: float = 0.7,
    ) -> str:
        """调用 LLM 并返回原始文本"""
        if not self.llm:
            raise StudioServiceError(
                "Studio LLM 服务未配置，请先在设置中配置 LLM API Key",
                error_code="config_missing_llm",
            )
        return await self.llm.generate_text(
            prompt=user_prompt,
            system_prompt=system_prompt,
            temperature=temperature,
            max_tokens=max_tokens,
        )

    # ------------------------------------------------------------------
    # A. 大脚本分幕拆解
    # ------------------------------------------------------------------

    async def split_script_to_acts(
        self,
        full_script: str,
        preferences: Dict[str, Any],
    ) -> List[Dict[str, Any]]:
        """LLM 分析脚本结构，识别自然分幕点。

        返回:
            [{"act_number", "title", "summary", "script_excerpt",
              "suggested_duration_seconds", "key_characters"}, ...]
        """
        target_count = preferences.get("target_episode_count", 0)
        episode_duration = preferences.get("episode_duration_seconds", 90)
        visual_style = preferences.get("visual_style", "电影级")

        user_prompt = SCRIPT_SPLIT_PROMPT.format(
            full_script=full_script,
            target_episode_count=target_count,
            episode_duration_seconds=episode_duration,
            visual_style=visual_style,
        )

        print("[Studio] 调用 LLM 进行脚本分幕拆解...")
        raw = await self._llm_call(
            user_prompt=user_prompt,
            system_prompt=SCRIPT_SPLIT_SYSTEM_PROMPT,
            max_tokens=8000,
            temperature=0.5,
        )

        acts = self._extract_json(raw)
        if not isinstance(acts, list) or not acts:
            raise StudioServiceError(
                "LLM 分幕结果解析失败",
                error_code="llm_invalid_split_output",
                context={"preview": raw[:500]},
            )

        # 确保格式完整
        for i, act in enumerate(acts):
            act.setdefault("act_number", i + 1)
            act.setdefault("title", f"第{i + 1}幕")
            act.setdefault("summary", "")
            act.setdefault("script_excerpt", "")
            act.setdefault("suggested_duration_seconds", episode_duration)
            act.setdefault("key_characters", [])

        print(f"[Studio] 分幕完成，共 {len(acts)} 幕")
        return acts

    # ------------------------------------------------------------------
    # B. 共享元素提取
    # ------------------------------------------------------------------

    async def extract_shared_elements(
        self,
        full_script: str,
        acts: List[Dict[str, Any]],
    ) -> List[Dict[str, Any]]:
        """从完整脚本提取贯穿全剧的角色/场景/道具。

        返回:
            [{"name", "type", "description", "voice_profile", "appears_in_acts"}, ...]
        """
        acts_summary = "\n".join(
            f"幕{a.get('act_number', i+1)}「{a.get('title', '')}」: {a.get('summary', '')}"
            for i, a in enumerate(acts)
        )

        user_prompt = ELEMENT_EXTRACTION_PROMPT.format(
            full_script=full_script,
            acts_summary=acts_summary,
        )

        print("[Studio] 调用 LLM 进行共享元素提取...")
        raw = await self._llm_call(
            user_prompt=user_prompt,
            system_prompt=ELEMENT_EXTRACTION_SYSTEM_PROMPT,
            max_tokens=8000,
            temperature=0.5,
        )

        elements = self._extract_json(raw)
        if not isinstance(elements, list):
            raise StudioServiceError(
                "LLM 元素提取结果解析失败",
                error_code="llm_invalid_elements_output",
                context={"preview": raw[:500]},
            )

        for el in elements:
            el.setdefault("name", "未知")
            el.setdefault("type", "character")
            el.setdefault("description", "")
            el.setdefault("voice_profile", "")
            el.setdefault("appears_in_acts", [])

        print(f"[Studio] 元素提取完成，共 {len(elements)} 个元素")
        return elements

    # ------------------------------------------------------------------
    # C. 创建系列（编排 A + B）
    # ------------------------------------------------------------------

    async def create_series(
        self,
        name: str,
        full_script: str,
        preferences: Dict[str, Any],
    ) -> Dict[str, Any]:
        """完整流程：分幕 → 提取元素 → 写入 SQLite → 返回系列概览"""

        # 1) 分幕
        acts = await self.split_script_to_acts(full_script, preferences)

        # 2) 提取共享元素
        elements = await self.extract_shared_elements(full_script, acts)

        # 3) 写入数据库 —— 系列
        visual_style = preferences.get("visual_style", "")
        series = self.storage.create_series(
            name=name,
            description=preferences.get("description", ""),
            source_script=full_script,
            series_bible=preferences.get("series_bible", ""),
            visual_style=visual_style,
        )
        series_id = series["id"]
        print(f"[Studio] 系列已创建: {series_id} ({name})")

        # 4) 写入集
        created_episodes = []
        for act in acts:
            ep = self.storage.create_episode(
                series_id=series_id,
                act_number=act["act_number"],
                title=act.get("title", ""),
                summary=act.get("summary", ""),
                script_excerpt=act.get("script_excerpt", ""),
                target_duration_seconds=act.get("suggested_duration_seconds", 90),
            )
            created_episodes.append(ep)

        # 5) 写入共享元素
        created_elements = []
        # 构建 act_number → episode_id 映射
        act_ep_map: Dict[int, str] = {
            ep["act_number"]: ep["id"] for ep in created_episodes
        }
        for el in elements:
            appears_episodes = [
                act_ep_map[an]
                for an in el.get("appears_in_acts", [])
                if an in act_ep_map
            ]
            se = self.storage.add_shared_element(
                series_id=series_id,
                name=el["name"],
                element_type=el["type"],
                description=el.get("description", ""),
                voice_profile=el.get("voice_profile", ""),
                appears_in_episodes=appears_episodes,
            )
            created_elements.append(se)

        return {
            "series": series,
            "episodes": created_episodes,
            "shared_elements": created_elements,
        }

    # ------------------------------------------------------------------
    # D. 分集规划
    # ------------------------------------------------------------------

    async def plan_episode(self, episode_id: str) -> Dict[str, Any]:
        """为单集生成详细分镜规划"""
        episode = self.storage.get_episode(episode_id)
        if not episode:
            raise StudioServiceError(
                f"集 {episode_id} 不存在",
                error_code="episode_not_found",
                context={"episode_id": episode_id},
            )

        series = self.storage.get_series(episode["series_id"])
        if not series:
            raise StudioServiceError(
                f"系列 {episode['series_id']} 不存在",
                error_code="series_not_found",
                context={"series_id": episode["series_id"]},
            )

        # 获取共享元素
        shared_elements = self.storage.get_shared_elements(series["id"])
        elements_list = "\n".join(
            f"- [{el['id']}] {el['name']}（{el['type']}）: {el['description']}"
            + (f" | 音色: {el['voice_profile']}" if el.get("voice_profile") else "")
            for el in shared_elements
        )

        # 获取前后集摘要
        all_episodes = self.storage.list_episodes(series["id"])
        act_num = episode["act_number"]
        prev_summary = "（这是第一集，没有前情）"
        next_summary = "（这是最后一集，没有后续）"
        for ep in all_episodes:
            if ep["act_number"] == act_num - 1:
                prev_summary = f"第{ep['act_number']}集「{ep['title']}」: {ep['summary']}"
            if ep["act_number"] == act_num + 1:
                next_summary = f"第{ep['act_number']}集「{ep['title']}」: {ep['summary']}"

        target_duration = episode.get("target_duration_seconds", 90)
        suggested_shots = max(5, math.ceil(target_duration / 7))

        user_prompt = EPISODE_PLANNING_PROMPT.format(
            series_name=series["name"],
            act_number=act_num,
            episode_title=episode.get("title", ""),
            series_bible=series.get("series_bible", ""),
            visual_style=series.get("visual_style", ""),
            shared_elements_list=elements_list or "（暂无共享元素）",
            prev_summary=prev_summary,
            script_excerpt=episode.get("script_excerpt", ""),
            next_summary=next_summary,
            target_duration_seconds=target_duration,
            suggested_shot_count=suggested_shots,
        )

        print(f"[Studio] 调用 LLM 规划第 {act_num} 集 ({episode_id})...")
        raw = await self._llm_call(
            user_prompt=user_prompt,
            system_prompt=EPISODE_PLANNING_SYSTEM_PROMPT,
            max_tokens=16000,
            temperature=0.7,
        )

        plan = self._extract_json(raw)
        if not isinstance(plan, dict):
            raise StudioServiceError(
                "LLM 分集规划结果解析失败",
                error_code="llm_invalid_plan_output",
                context={"episode_id": episode_id, "preview": raw[:500]},
            )

        # 保存 creative_brief
        brief = plan.get("creative_brief", {})
        self.storage.update_episode(episode_id, {
            "creative_brief": brief,
            "status": "planned",
        })

        # 写入新元素到 episode_elements
        for new_el in plan.get("new_elements", []):
            self.storage.add_episode_element(
                episode_id=episode_id,
                name=new_el.get("name", ""),
                element_type=new_el.get("type", "character"),
                description=new_el.get("description", ""),
                voice_profile=new_el.get("voice_profile", ""),
            )

        # 继承共享元素到集
        self.storage.inherit_shared_elements(episode_id, series["id"])

        # 写入镜头
        shots_data = []
        sort_order = 0
        for segment in plan.get("segments", []):
            seg_name = segment.get("name", "")
            for shot in segment.get("shots", []):
                sort_order += 1
                shots_data.append({
                    "segment_name": seg_name,
                    "sort_order": sort_order,
                    "name": shot.get("name", ""),
                    "shot_type": shot.get("type", "standard"),
                    "duration": shot.get("duration", 6.0),
                    "description": shot.get("description", ""),
                    "prompt": shot.get("prompt", ""),
                    "video_prompt": shot.get("video_prompt", ""),
                    "narration": shot.get("narration", ""),
                    "dialogue_script": shot.get("dialogue_script", ""),
                })

        # 清空已有镜头再写入
        existing = self.storage.get_shots(episode_id)
        for s in existing:
            self.storage.delete_shot(s["id"])

        created_shots = self.storage.bulk_add_shots(episode_id, shots_data)
        print(f"[Studio] 第 {act_num} 集规划完成，共 {len(created_shots)} 个镜头")

        return {
            "episode_id": episode_id,
            "creative_brief": brief,
            "new_elements": plan.get("new_elements", []),
            "shots_count": len(created_shots),
            "shots": created_shots,
        }

    # ------------------------------------------------------------------
    # E. 单集增强（Script Doctor）
    # ------------------------------------------------------------------

    async def enhance_episode(
        self,
        episode_id: str,
        mode: str = "refine",
    ) -> Dict[str, Any]:
        """对单集分镜做 Script Doctor 式增强"""
        episode = self.storage.get_episode(episode_id)
        if not episode:
            raise StudioServiceError(
                f"集 {episode_id} 不存在",
                error_code="episode_not_found",
                context={"episode_id": episode_id},
            )

        series = self.storage.get_series(episode["series_id"])
        if not series:
            raise StudioServiceError(
                f"系列 {episode['series_id']} 不存在",
                error_code="series_not_found",
                context={"series_id": episode["series_id"]},
            )

        shared_elements = self.storage.get_shared_elements(series["id"])
        elements_list = "\n".join(
            f"- [{el['id']}] {el['name']}（{el['type']}）: {el['description']}"
            for el in shared_elements
        )

        # 获取当前集的完整快照用于输入
        snapshot = self.storage.get_episode_snapshot(episode_id)
        episode_json = json.dumps(snapshot, ensure_ascii=False, indent=2)

        user_prompt = EPISODE_ENHANCE_PROMPT.format(
            series_bible=series.get("series_bible", ""),
            shared_elements_list=elements_list or "（暂无共享元素）",
            episode_json=episode_json,
            mode=mode,
        )

        print(f"[Studio] Script Doctor 增强 {episode_id}（{mode}模式）...")
        raw = await self._llm_call(
            user_prompt=user_prompt,
            system_prompt=EPISODE_ENHANCE_SYSTEM_PROMPT,
            max_tokens=16000,
            temperature=0.7,
        )

        patch = self._extract_json(raw)
        if not isinstance(patch, dict):
            raise StudioServiceError(
                "LLM 增强结果解析失败",
                error_code="llm_invalid_enhance_output",
                context={"episode_id": episode_id, "preview": raw[:500]},
            )

        patched_count = 0
        added_count = 0

        # 应用 shots_patch（修改已有镜头）
        for sp in patch.get("shots_patch", []):
            shot_id = sp.get("id")
            if not shot_id:
                continue
            updates = {}
            for field in ("description", "prompt", "video_prompt", "narration", "dialogue_script", "duration"):
                if field in sp:
                    updates[field] = sp[field]
            if updates:
                self.storage.update_shot(shot_id, updates)
                patched_count += 1

        # 应用 add_shots（新增镜头），仅 expand 模式
        if mode == "expand":
            existing_shots = self.storage.get_shots(episode_id)
            ordered_ids = [s["id"] for s in existing_shots]
            base_sort_order = len(existing_shots) + 1000

            for add_item in patch.get("add_shots", []):
                after_id = add_item.get("after_shot_id", "")
                shot_data = add_item.get("shot", {})
                insert_at = len(ordered_ids)
                if after_id and after_id in ordered_ids:
                    insert_at = ordered_ids.index(after_id) + 1

                created = self.storage.add_shot(
                    episode_id=episode_id,
                    segment_name=shot_data.get("segment_name", ""),
                    sort_order=base_sort_order + added_count,
                    name=shot_data.get("name", ""),
                    shot_type=shot_data.get("type", "standard"),
                    duration=shot_data.get("duration", 5.0),
                    description=shot_data.get("description", ""),
                    prompt=shot_data.get("prompt", ""),
                    video_prompt=shot_data.get("video_prompt", ""),
                    narration=shot_data.get("narration", ""),
                    dialogue_script=shot_data.get("dialogue_script", ""),
                )
                ordered_ids.insert(insert_at, created["id"])
                added_count += 1

            if added_count > 0:
                self.storage.reorder_shots(episode_id, ordered_ids)

        print(f"[Studio] 增强完成: 修改 {patched_count} 个镜头, 新增 {added_count} 个镜头")
        return {
            "episode_id": episode_id,
            "mode": mode,
            "patched": patched_count,
            "added": added_count,
        }

    # ------------------------------------------------------------------
    # F. 资产生成
    # ------------------------------------------------------------------

    async def generate_element_image(
        self,
        element_id: str,
        width: int = 1024,
        height: int = 1024,
    ) -> Dict[str, Any]:
        """为共享元素生成参考图"""
        if not self.image:
            raise StudioServiceError(
                "Studio 图像服务未配置",
                error_code="config_missing_image",
            )

        el = self.storage.get_shared_element(element_id)
        if not el:
            raise StudioServiceError(
                f"共享元素 {element_id} 不存在",
                error_code="element_not_found",
                context={"element_id": element_id},
            )

        prompt = el["description"]
        ref_images = el.get("reference_images") or []

        result = await self.image.generate(
            prompt=prompt,
            reference_images=ref_images if ref_images else None,
            width=width,
            height=height,
        )

        url = result.get("url", "")
        if url:
            # 更新元素的 image_url 和 image_history
            history = el.get("image_history") or []
            if el.get("image_url"):
                history.append(el["image_url"])
            self.storage.update_shared_element(element_id, {
                "image_url": url,
                "image_history": history,
            })

        return {"element_id": element_id, "image_url": url, "result": result}

    async def generate_shot_frame(
        self,
        shot_id: str,
        width: int = 1280,
        height: int = 720,
    ) -> Dict[str, Any]:
        """为镜头生成起始帧"""
        if not self.image:
            raise StudioServiceError(
                "Studio 图像服务未配置",
                error_code="config_missing_image",
            )

        shot = self.storage.get_shot(shot_id)
        if not shot:
            raise StudioServiceError(
                f"镜头 {shot_id} 不存在",
                error_code="shot_not_found",
                context={"shot_id": shot_id},
            )

        # 解析 prompt 中的 [SE_XXX] 引用，替换为元素描述
        prompt = self._resolve_element_refs(shot["prompt"], shot["episode_id"])

        # 收集引用元素的参考图
        ref_images = self._collect_ref_images(shot["prompt"], shot["episode_id"])

        result = await self.image.generate(
            prompt=prompt,
            reference_images=ref_images if ref_images else None,
            width=width,
            height=height,
        )

        url = result.get("url", "")
        if url:
            self.storage.update_shot(shot_id, {"start_image_url": url})

        return {"shot_id": shot_id, "start_image_url": url, "result": result}

    async def generate_shot_video(
        self,
        shot_id: str,
    ) -> Dict[str, Any]:
        """为镜头生成视频"""
        if not self.video:
            raise StudioServiceError(
                "Studio 视频服务未配置",
                error_code="config_missing_video",
            )

        shot = self.storage.get_shot(shot_id)
        if not shot:
            raise StudioServiceError(
                f"镜头 {shot_id} 不存在",
                error_code="shot_not_found",
                context={"shot_id": shot_id},
            )
        if not shot.get("start_image_url"):
            raise StudioServiceError(
                f"镜头 {shot_id} 尚未生成起始帧，请先生成图片",
                error_code="shot_missing_start_frame",
                context={"shot_id": shot_id},
            )

        video_prompt = self._resolve_element_refs(
            shot.get("video_prompt") or shot.get("prompt", ""),
            shot["episode_id"],
        )

        self.storage.update_shot(shot_id, {"status": "generating"})

        try:
            result = await self.video.generate(
                image_url=shot["start_image_url"],
                prompt=video_prompt,
                duration=shot.get("duration", 5.0),
            )

            video_url = result.get("video_url", "")
            self.storage.update_shot(shot_id, {
                "video_url": video_url,
                "status": "completed" if video_url else "failed",
            })
            return {"shot_id": shot_id, "video_url": video_url, "result": result}

        except Exception as e:
            self.storage.update_shot(shot_id, {"status": "failed"})
            raise

    async def generate_shot_audio(
        self,
        shot_id: str,
        voice_type: Optional[str] = None,
    ) -> Dict[str, Any]:
        """为镜头生成旁白/对白音频"""
        if not self.tts:
            raise StudioServiceError(
                "Studio TTS 服务未配置",
                error_code="config_missing_tts",
            )

        shot = self.storage.get_shot(shot_id)
        if not shot:
            raise StudioServiceError(
                f"镜头 {shot_id} 不存在",
                error_code="shot_not_found",
                context={"shot_id": shot_id},
            )

        # 优先使用旁白，其次对白
        text = shot.get("narration", "").strip()
        if not text:
            text = shot.get("dialogue_script", "").strip()
        if not text:
            return {"shot_id": shot_id, "audio_url": "", "message": "无旁白/对白文本"}

        # 自动选择音色
        if not voice_type:
            voice_type = VolcTTSService.auto_pick_voice_type(
                role="narration" if shot.get("narration") else "dialogue",
                description=text,
            )

        audio_data, _ = await self.tts.synthesize(
            text=text,
            voice_type=voice_type,
        )

        # 保存音频文件
        import os
        audio_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "studio_audio")
        os.makedirs(audio_dir, exist_ok=True)
        audio_path = os.path.join(audio_dir, f"{shot_id}.mp3")
        with open(audio_path, "wb") as f:
            f.write(audio_data)

        audio_url = f"/data/studio_audio/{shot_id}.mp3"
        self.storage.update_shot(shot_id, {"audio_url": audio_url})

        return {"shot_id": shot_id, "audio_url": audio_url}

    async def batch_generate_episode(
        self,
        episode_id: str,
        stages: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """批量生成单集资产

        stages 可包含: "elements", "frames", "videos", "audio"
        默认全部执行。
        """
        if stages is None:
            stages = ["elements", "frames", "videos", "audio"]

        episode = self.storage.get_episode(episode_id)
        if not episode:
            raise StudioServiceError(
                f"集 {episode_id} 不存在",
                error_code="episode_not_found",
                context={"episode_id": episode_id},
            )

        result: Dict[str, Any] = {"episode_id": episode_id, "stages": {}}

        # 1) 生成共享元素参考图
        if "elements" in stages:
            series_id = episode["series_id"]
            elements = self.storage.get_shared_elements(series_id)
            elem_results = []
            for el in elements:
                if not el.get("image_url"):
                    try:
                        r = await self.generate_element_image(el["id"])
                        elem_results.append(r)
                    except Exception as e:
                        elem_results.append({"element_id": el["id"], "error": str(e)})
            result["stages"]["elements"] = elem_results

        shots = self.storage.get_shots(episode_id)

        # 2) 生成起始帧
        if "frames" in stages:
            frame_results = []
            for shot in shots:
                if not shot.get("start_image_url"):
                    try:
                        r = await self.generate_shot_frame(shot["id"])
                        frame_results.append(r)
                    except Exception as e:
                        frame_results.append({"shot_id": shot["id"], "error": str(e)})
            result["stages"]["frames"] = frame_results

        # 3) 生成视频
        if "videos" in stages:
            # 刷新 shots（起始帧 URL 可能已更新）
            shots = self.storage.get_shots(episode_id)
            video_results = []
            for shot in shots:
                if shot.get("start_image_url") and not shot.get("video_url"):
                    try:
                        r = await self.generate_shot_video(shot["id"])
                        video_results.append(r)
                    except Exception as e:
                        video_results.append({"shot_id": shot["id"], "error": str(e)})
            result["stages"]["videos"] = video_results

        # 4) 生成音频
        if "audio" in stages:
            shots = self.storage.get_shots(episode_id)
            audio_results = []
            for shot in shots:
                text = (shot.get("narration") or "").strip() or (shot.get("dialogue_script") or "").strip()
                if text and not shot.get("audio_url"):
                    try:
                        r = await self.generate_shot_audio(shot["id"])
                        audio_results.append(r)
                    except Exception as e:
                        audio_results.append({"shot_id": shot["id"], "error": str(e)})
            result["stages"]["audio"] = audio_results

        # 更新集状态
        self.storage.update_episode(episode_id, {"status": "in_progress"})

        return result

    # ------------------------------------------------------------------
    # 元素引用解析
    # ------------------------------------------------------------------

    def _resolve_element_refs(self, text: str, episode_id: str) -> str:
        """将 [SE_XXX] 引用替换为元素的实际描述"""
        if not text:
            return text

        episode = self.storage.get_episode(episode_id)
        if not episode:
            return text

        elements = self.storage.get_shared_elements(episode["series_id"])
        id_to_desc = {el["id"]: el["description"] for el in elements}

        def replacer(m: re.Match) -> str:
            eid = m.group(1)
            return id_to_desc.get(eid, m.group(0))

        return re.sub(r"\[(SE_[a-zA-Z0-9]+)\]", replacer, text)

    def _collect_ref_images(self, text: str, episode_id: str) -> List[str]:
        """从 prompt 中提取 [SE_XXX] 引用的元素参考图 URL"""
        if not text:
            return []

        episode = self.storage.get_episode(episode_id)
        if not episode:
            return []

        elements = self.storage.get_shared_elements(episode["series_id"])
        id_to_img = {el["id"]: el.get("image_url", "") for el in elements}

        refs = re.findall(r"\[(SE_[a-zA-Z0-9]+)\]", text)
        images = []
        for ref_id in refs:
            img = id_to_img.get(ref_id, "")
            if img:
                images.append(img)
        return images

    # ------------------------------------------------------------------
    # 查询/导出
    # ------------------------------------------------------------------

    def get_series_detail(self, series_id: str) -> Optional[Dict[str, Any]]:
        """获取系列完整详情（含集列表和共享元素）"""
        series = self.storage.get_series(series_id)
        if not series:
            return None
        episodes = self.storage.list_episodes(series_id)
        elements = self.storage.get_shared_elements(series_id)
        return {
            **series,
            "episodes": episodes,
            "shared_elements": elements,
        }

    def get_episode_detail(self, episode_id: str) -> Optional[Dict[str, Any]]:
        """获取集完整详情（含镜头和集元素）"""
        episode = self.storage.get_episode(episode_id)
        if not episode:
            return None
        shots = self.storage.get_shots(episode_id)
        ep_elements = self.storage.get_episode_elements(episode_id)
        return {
            **episode,
            "shots": shots,
            "episode_elements": ep_elements,
        }
