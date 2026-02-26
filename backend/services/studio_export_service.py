"""Studio 导出服务。

为 Studio 工作台提供真实素材导出与视频合并导出能力。
"""

from __future__ import annotations

import csv
import io
import json
import os
import re
import shutil
import tempfile
import zipfile
from datetime import datetime
from typing import Any, Dict, List, Optional

from .export_service import export_service
from .studio_storage import StudioStorage


class StudioExportService:
    def __init__(self, storage: StudioStorage, output_dir: Optional[str] = None):
        self.storage = storage
        self.output_dir = output_dir or export_service.output_dir
        os.makedirs(self.output_dir, exist_ok=True)

    @staticmethod
    def _safe_name(value: str, fallback: str = "untitled") -> str:
        name = (value or "").strip() or fallback
        name = name.replace("\n", " ").replace("\r", " ")
        name = re.sub(r'[\\/:*?"<>|]+', "_", name)
        name = re.sub(r"\s+", " ", name).strip()
        return name[:120] or fallback

    @staticmethod
    def _format_srt_time(seconds: float) -> str:
        if seconds < 0:
            seconds = 0.0
        total_ms = int(round(seconds * 1000))
        h = total_ms // 3_600_000
        m = (total_ms % 3_600_000) // 60_000
        s = (total_ms % 60_000) // 1000
        ms = total_ms % 1000
        return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"

    def _build_episode_srt(self, shots: List[Dict[str, Any]]) -> str:
        lines: List[str] = []
        cursor = 0.0
        idx = 1
        for shot in shots:
            duration = float(shot.get("duration") or 0)
            if duration <= 0:
                duration = 1.0
            text = (shot.get("narration") or shot.get("dialogue_script") or "").strip()
            if not text:
                cursor += duration
                continue

            start = self._format_srt_time(cursor)
            end = self._format_srt_time(cursor + duration)
            lines.append(str(idx))
            lines.append(f"{start} --> {end}")
            lines.append(text)
            lines.append("")

            idx += 1
            cursor += duration

        return "\n".join(lines).strip() + ("\n" if lines else "")

    def _build_episode_csv(self, shots: List[Dict[str, Any]]) -> str:
        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow([
            "index",
            "shot_id",
            "name",
            "duration",
            "status",
            "description",
            "prompt",
            "end_prompt",
            "video_prompt",
            "narration",
            "dialogue_script",
            "start_image_url",
            "end_image_url",
            "video_url",
            "audio_url",
        ])
        for i, shot in enumerate(shots, start=1):
            writer.writerow([
                i,
                shot.get("id", ""),
                shot.get("name", ""),
                shot.get("duration", 0),
                shot.get("status", ""),
                shot.get("description", ""),
                shot.get("prompt", ""),
                shot.get("end_prompt", ""),
                shot.get("video_prompt", ""),
                shot.get("narration", ""),
                shot.get("dialogue_script", ""),
                shot.get("start_image_url", ""),
                shot.get("end_image_url", ""),
                shot.get("video_url", ""),
                shot.get("audio_url", ""),
            ])
        return buf.getvalue()

    async def _download_if_present(
        self,
        url: str,
        filepath: str,
        kind: str,
        name: str,
        failures: List[Dict[str, str]],
    ) -> bool:
        if not url:
            return False
        try:
            await export_service._download_file(url, filepath)
            return True
        except Exception as e:
            failures.append({
                "type": kind,
                "name": name,
                "url": str(url),
                "error": str(e),
            })
            return False

    @staticmethod
    def _shot_to_video_export_item(shot: Dict[str, Any]) -> Dict[str, Any]:
        return {
            **shot,
            "voice_audio_url": shot.get("audio_url") or "",
        }

    async def _export_episode_folder(
        self,
        parent_dir: str,
        episode: Dict[str, Any],
        shared_elements: List[Dict[str, Any]],
        *,
        include_shared_elements: bool,
    ) -> Dict[str, Any]:
        act_no = int(episode.get("act_number") or 0)
        ep_title = self._safe_name(episode.get("title", ""), fallback=f"episode_{act_no or 0}")
        episode_dir = os.path.join(parent_dir, f"{act_no:02d}_{ep_title}_{episode.get('id', '')}")
        os.makedirs(episode_dir, exist_ok=True)

        elements_dir = os.path.join(episode_dir, "elements")
        frames_dir = os.path.join(episode_dir, "frames")
        videos_dir = os.path.join(episode_dir, "videos")
        audio_dir = os.path.join(episode_dir, "audio")
        metadata_dir = os.path.join(episode_dir, "metadata")
        os.makedirs(elements_dir, exist_ok=True)
        os.makedirs(frames_dir, exist_ok=True)
        os.makedirs(videos_dir, exist_ok=True)
        os.makedirs(audio_dir, exist_ok=True)
        os.makedirs(metadata_dir, exist_ok=True)

        failures: List[Dict[str, str]] = []
        stats = {
            "elements": 0,
            "start_frames": 0,
            "end_frames": 0,
            "videos": 0,
            "audio": 0,
        }

        if include_shared_elements:
            for el in shared_elements:
                img_url = str(el.get("image_url") or "")
                if not img_url:
                    continue
                name = self._safe_name(el.get("name", ""), fallback=str(el.get("id") or "element"))
                ext = os.path.splitext((img_url.split("?")[0] or ""))[1] or ".png"
                if len(ext) > 6:
                    ext = ".png"
                target = os.path.join(elements_dir, f"{name}_{el.get('id')}{ext}")
                if await self._download_if_present(img_url, target, "element", name, failures):
                    stats["elements"] += 1

        shots = episode.get("shots") or []
        if not isinstance(shots, list):
            shots = []

        for i, shot in enumerate(shots, start=1):
            shot_name = self._safe_name(shot.get("name", ""), fallback=f"shot_{i:03d}")
            shot_id = str(shot.get("id") or "")
            base = f"{i:03d}_{shot_name}_{shot_id}".rstrip("_")

            start_url = str(shot.get("start_image_url") or "")
            if start_url:
                ext = os.path.splitext((start_url.split("?")[0] or ""))[1] or ".png"
                if len(ext) > 6:
                    ext = ".png"
                target = os.path.join(frames_dir, f"{base}_start{ext}")
                if await self._download_if_present(start_url, target, "start_frame", shot_name, failures):
                    stats["start_frames"] += 1

            end_url = str(shot.get("end_image_url") or "")
            if end_url:
                ext = os.path.splitext((end_url.split("?")[0] or ""))[1] or ".png"
                if len(ext) > 6:
                    ext = ".png"
                target = os.path.join(frames_dir, f"{base}_end{ext}")
                if await self._download_if_present(end_url, target, "end_frame", shot_name, failures):
                    stats["end_frames"] += 1

            video_url = str(shot.get("video_url") or "")
            if video_url:
                ext = os.path.splitext((video_url.split("?")[0] or ""))[1] or ".mp4"
                if len(ext) > 6:
                    ext = ".mp4"
                target = os.path.join(videos_dir, f"{base}{ext}")
                if await self._download_if_present(video_url, target, "video", shot_name, failures):
                    stats["videos"] += 1

            audio_url = str(shot.get("audio_url") or "")
            if audio_url:
                ext = os.path.splitext((audio_url.split("?")[0] or ""))[1] or ".mp3"
                if len(ext) > 6:
                    ext = ".mp3"
                target = os.path.join(audio_dir, f"{base}{ext}")
                if await self._download_if_present(audio_url, target, "audio", shot_name, failures):
                    stats["audio"] += 1

        metadata = {
            "episode": episode,
            "exported_at": datetime.now().isoformat(),
            "stats": stats,
        }
        with open(os.path.join(metadata_dir, "episode.json"), "w", encoding="utf-8") as f:
            json.dump(metadata, f, ensure_ascii=False, indent=2)
        with open(os.path.join(metadata_dir, "shots.csv"), "w", encoding="utf-8", newline="") as f:
            f.write(self._build_episode_csv(shots))
        with open(os.path.join(metadata_dir, "subtitles.srt"), "w", encoding="utf-8") as f:
            f.write(self._build_episode_srt(shots))
        if failures:
            with open(os.path.join(metadata_dir, "failed_downloads.json"), "w", encoding="utf-8") as f:
                json.dump(failures, f, ensure_ascii=False, indent=2)

        return {
            "episode_id": episode.get("id"),
            "episode_dir": episode_dir,
            "stats": stats,
            "failures": len(failures),
        }

    async def export_episode_assets_zip(self, episode_id: str) -> str:
        episode = self.storage.get_episode_snapshot(episode_id)
        if not episode:
            raise ValueError("episode_not_found")
        series = self.storage.get_series(episode.get("series_id", ""))
        if not series:
            raise ValueError("series_not_found")
        shared_elements = self.storage.get_shared_elements(series["id"])

        temp_dir = tempfile.mkdtemp(prefix="studio_ep_export_")
        try:
            series_name = self._safe_name(series.get("name", ""), fallback=series["id"])
            ep_title = self._safe_name(episode.get("title", ""), fallback=episode["id"])
            root_name = f"{series_name}_E{int(episode.get('act_number') or 0):02d}_{ep_title}_{episode['id']}"
            root_dir = os.path.join(temp_dir, root_name)
            os.makedirs(root_dir, exist_ok=True)

            await self._export_episode_folder(
                root_dir,
                episode,
                shared_elements,
                include_shared_elements=True,
            )

            with open(os.path.join(root_dir, "series.json"), "w", encoding="utf-8") as f:
                json.dump(series, f, ensure_ascii=False, indent=2)

            zip_name = f"{root_name}.zip"
            zip_path = os.path.join(self.output_dir, zip_name)
            with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
                for base, _, files in os.walk(root_dir):
                    for file in files:
                        file_path = os.path.join(base, file)
                        arcname = os.path.relpath(file_path, temp_dir)
                        zf.write(file_path, arcname)
            return zip_path
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)

    async def export_series_assets_zip(self, series_id: str) -> str:
        series = self.storage.get_series_snapshot(series_id)
        if not series:
            raise ValueError("series_not_found")

        shared_elements = series.get("shared_elements") or []
        episodes = list(series.get("episodes") or [])
        episodes.sort(key=lambda ep: int(ep.get("act_number") or 0))

        temp_dir = tempfile.mkdtemp(prefix="studio_series_export_")
        try:
            series_name = self._safe_name(series.get("name", ""), fallback=series_id)
            root_name = f"{series_name}_{series_id}"
            root_dir = os.path.join(temp_dir, root_name)
            os.makedirs(root_dir, exist_ok=True)

            shared_dir = os.path.join(root_dir, "shared_elements")
            os.makedirs(shared_dir, exist_ok=True)
            shared_failures: List[Dict[str, str]] = []
            for el in shared_elements:
                img_url = str(el.get("image_url") or "")
                if not img_url:
                    continue
                name = self._safe_name(el.get("name", ""), fallback=str(el.get("id") or "element"))
                ext = os.path.splitext((img_url.split("?")[0] or ""))[1] or ".png"
                if len(ext) > 6:
                    ext = ".png"
                target = os.path.join(shared_dir, f"{name}_{el.get('id')}{ext}")
                await self._download_if_present(img_url, target, "shared_element", name, shared_failures)
            if shared_failures:
                with open(os.path.join(shared_dir, "failed_downloads.json"), "w", encoding="utf-8") as f:
                    json.dump(shared_failures, f, ensure_ascii=False, indent=2)

            episodes_dir = os.path.join(root_dir, "episodes")
            os.makedirs(episodes_dir, exist_ok=True)
            summary: List[Dict[str, Any]] = []
            for episode in episodes:
                summary.append(
                    await self._export_episode_folder(
                        episodes_dir,
                        episode,
                        shared_elements,
                        include_shared_elements=False,
                    )
                )

            with open(os.path.join(root_dir, "series.json"), "w", encoding="utf-8") as f:
                json.dump(series, f, ensure_ascii=False, indent=2)
            with open(os.path.join(root_dir, "export_summary.json"), "w", encoding="utf-8") as f:
                json.dump(summary, f, ensure_ascii=False, indent=2)

            zip_name = f"{root_name}.zip"
            zip_path = os.path.join(self.output_dir, zip_name)
            with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
                for base, _, files in os.walk(root_dir):
                    for file in files:
                        file_path = os.path.join(base, file)
                        arcname = os.path.relpath(file_path, temp_dir)
                        zf.write(file_path, arcname)
            return zip_path
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)

    async def export_episode_merged_video(self, episode_id: str, resolution: str = "720p") -> str:
        episode = self.storage.get_episode_snapshot(episode_id)
        if not episode:
            raise ValueError("episode_not_found")
        series = self.storage.get_series(episode.get("series_id", ""))
        if not series:
            raise ValueError("series_not_found")

        shots = list(episode.get("shots") or [])
        shots.sort(key=lambda s: int(s.get("sort_order") or 0))
        segments = [{
            "name": episode.get("title") or f"第{episode.get('act_number')}幕",
            "shots": [self._shot_to_video_export_item(s) for s in shots],
        }]

        project_name = self._safe_name(
            f"{series.get('name', '')}_E{int(episode.get('act_number') or 0):02d}_{episode.get('title', '')}",
            fallback=episode_id,
        )
        return await export_service.export_merged_video(
            project_id=episode_id,
            project_name=project_name,
            segments=segments,
            output_resolution=resolution,
        )

    async def export_series_merged_video(self, series_id: str, resolution: str = "720p") -> str:
        series = self.storage.get_series_snapshot(series_id)
        if not series:
            raise ValueError("series_not_found")

        episodes = list(series.get("episodes") or [])
        episodes.sort(key=lambda ep: int(ep.get("act_number") or 0))
        segments: List[Dict[str, Any]] = []
        for ep in episodes:
            shots = list(ep.get("shots") or [])
            shots.sort(key=lambda s: int(s.get("sort_order") or 0))
            segments.append({
                "name": ep.get("title") or f"第{ep.get('act_number')}幕",
                "shots": [self._shot_to_video_export_item(s) for s in shots],
            })

        project_name = self._safe_name(series.get("name", ""), fallback=series_id)
        return await export_service.export_merged_video(
            project_id=series_id,
            project_name=project_name,
            segments=segments,
            output_resolution=resolution,
        )
