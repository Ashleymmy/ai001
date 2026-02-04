"""
导出服务
支持导出项目素材和拼接视频
"""
import os
import zipfile
import subprocess
import tempfile
import shutil
import base64
import re
import urllib.parse
from typing import Dict, Any, List, Optional
import httpx
import asyncio


class ExportService:
    def __init__(self, output_dir: str = None):
        if output_dir is None:
            output_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "outputs")
        self.output_dir = output_dir
        os.makedirs(output_dir, exist_ok=True)
        print(f"[ExportService] 初始化，输出目录: {output_dir}")
    
    async def export_project_assets(
        self,
        project_id: str,
        project_name: str,
        elements: Dict[str, Any],
        segments: List[Any],
        visual_assets: List[Any]
    ) -> str:
        """
        导出项目所有素材，按类型分类打包
        
        Returns:
            zip 文件路径
        """
        print(f"[ExportService] 开始导出项目素材: {project_name}")
        
        # 创建临时目录
        temp_dir = tempfile.mkdtemp()
        safe_project_name = str(project_name or "").strip() or str(project_id)
        safe_project_name = safe_project_name.replace("\n", " ").replace("\r", " ")
        safe_project_name = re.sub(r'[\\\\/:*?"<>|]+', "_", safe_project_name)[:120]
        project_dir = os.path.join(temp_dir, safe_project_name)
        os.makedirs(project_dir, exist_ok=True)
        
        try:
            def sanitize_filename(name: str, fallback: str = "unnamed") -> str:
                value = str(name or "").strip() or fallback
                value = value.replace("\n", " ").replace("\r", " ")
                value = re.sub(r'[\\\\/:*?"<>|]+', "_", value)
                return value[:120]

            def infer_ext(url: str, default_ext: str) -> str:
                try:
                    path = urllib.parse.urlparse(url).path
                    ext = os.path.splitext(path)[1].lower()
                    if ext and len(ext) <= 5:
                        return ext
                except Exception:
                    pass
                return default_ext

            # 创建分类目录
            elements_dir = os.path.join(project_dir, "1_角色元素")
            frames_dir = os.path.join(project_dir, "2_镜头起始帧")
            videos_dir = os.path.join(project_dir, "3_视频片段")
            audio_dir = os.path.join(project_dir, "4_音频(旁白对白)")
            os.makedirs(elements_dir, exist_ok=True)
            os.makedirs(frames_dir, exist_ok=True)
            os.makedirs(videos_dir, exist_ok=True)
            os.makedirs(audio_dir, exist_ok=True)
            
            # 下载角色元素图片
            element_count = 0
            failed_count = 0
            failed_records: List[Dict[str, str]] = []
            for elem_id, elem in elements.items():
                element_url = elem.get("cached_image_url") or elem.get("image_url")
                if element_url:
                    safe_name = sanitize_filename(elem.get('name', elem_id), fallback=str(elem_id))
                    filename = f"{safe_name}{infer_ext(str(element_url), '.png')}"
                    filepath = os.path.join(elements_dir, filename)
                    try:
                        await self._download_file(str(element_url), filepath)
                        element_count += 1
                        print(f"[ExportService] 已下载角色: {filename}")
                    except Exception as e:
                        failed_count += 1
                        failed_records.append({
                            "type": "element",
                            "name": str(elem.get("name") or elem_id),
                            "url": str(element_url or ""),
                            "error": str(e),
                        })
                        print(f"[ExportService] 角色下载失败: {filename} ({e})")
            
            # 下载镜头起始帧和视频
            frame_count = 0
            video_count = 0
            audio_count = 0
            shot_global_index = 0
            shot_index_map: List[Dict[str, str]] = []
            for seg in segments:
                for shot in seg.get('shots', []):
                    shot_global_index += 1
                    shot_name = shot.get('name', shot.get('id', 'unknown'))
                    safe_shot_name = sanitize_filename(shot_name, fallback=str(shot.get('id', 'unknown')))
                    shot_id = str(shot.get('id') or "")
                    unique_suffix = f"_{shot_id}" if shot_id and shot_id not in safe_shot_name else ""
                    prefix = f"{shot_global_index:03d}_"

                    shot_index_map.append({
                        "index": f"{shot_global_index:03d}",
                        "shot_id": shot_id,
                        "shot_name": str(shot.get("name") or "").strip() or str(shot_id or "unknown"),
                        "segment_name": str(seg.get("name") or "").strip() or "Unnamed",
                    })
                    
                    # 起始帧
                    start_frame_url = (
                        shot.get("cached_start_image_url")
                        or shot.get("start_image_url")
                        or shot.get("start_frame_url")
                    )
                    if start_frame_url:
                        filename = f"{prefix}{safe_shot_name}{unique_suffix}_frame{infer_ext(start_frame_url, '.png')}"
                        filepath = os.path.join(frames_dir, filename)
                        try:
                            await self._download_file(start_frame_url, filepath)
                            frame_count += 1
                            print(f"[ExportService] 已下载起始帧: {filename}")
                        except Exception as e:
                            failed_count += 1
                            failed_records.append({
                                "type": "start_frame",
                                "name": str(shot.get("name") or shot.get("id") or "unknown"),
                                "url": str(start_frame_url),
                                "error": str(e),
                            })
                            print(f"[ExportService] 起始帧下载失败: {filename} ({e})")
                    
                    # 视频
                    if shot.get('video_url'):
                        filename = f"{prefix}{safe_shot_name}{unique_suffix}{infer_ext(shot['video_url'], '.mp4')}"
                        filepath = os.path.join(videos_dir, filename)
                        try:
                            await self._download_file(shot['video_url'], filepath)
                            video_count += 1
                            print(f"[ExportService] 已下载视频: {filename}")
                        except Exception as e:
                            failed_count += 1
                            failed_records.append({
                                "type": "video",
                                "name": str(shot.get("name") or shot.get("id") or "unknown"),
                                "url": str(shot.get("video_url") or ""),
                                "error": str(e),
                            })
                            print(f"[ExportService] 视频下载失败: {filename} ({e})")

                    # 旁白/对白音频（独立 TTS 生成的人声轨）
                    voice_audio_url = shot.get("voice_audio_url")
                    if voice_audio_url:
                        filename = f"{prefix}{safe_shot_name}{unique_suffix}_voice{infer_ext(voice_audio_url, '.mp3')}"
                        filepath = os.path.join(audio_dir, filename)
                        try:
                            await self._download_file(voice_audio_url, filepath)
                            audio_count += 1
                            print(f"[ExportService] 已下载音频: {filename}")
                        except Exception as e:
                            failed_count += 1
                            failed_records.append({
                                "type": "audio",
                                "name": str(shot.get("name") or shot.get("id") or "unknown"),
                                "url": str(voice_audio_url),
                                "error": str(e),
                            })
                            print(f"[ExportService] 音频下载失败: {filename} ({e})")
            
            # 创建项目信息文件
            info_file = os.path.join(project_dir, "项目信息.txt")
            with open(info_file, 'w', encoding='utf-8') as f:
                f.write(f"项目名称: {project_name}\n")
                f.write(f"项目ID: {project_id}\n")
                f.write(f"\n=== 素材统计 ===\n")
                f.write(f"角色元素: {element_count} 个\n")
                f.write(f"镜头起始帧: {frame_count} 个\n")
                f.write(f"视频片段: {video_count} 个\n")
                f.write(f"旁白/对白音频: {audio_count} 个\n")
                f.write(f"下载失败: {failed_count} 个\n")

                f.write(f"\n=== 镜头序号对照(导出文件名前缀) ===\n")
                f.write("序号\tshot_id\t镜头名\t段落\n")
                for rec in shot_index_map:
                    f.write(f"{rec.get('index')}\t{rec.get('shot_id') or '-'}\t{rec.get('shot_name')}\t{rec.get('segment_name')}\n")

                f.write(f"\n=== 分镜列表 ===\n")
                for i, seg in enumerate(segments, 1):
                    f.write(f"\n段落 {i}: {seg.get('name', 'Unnamed')}\n")
                    f.write(f"描述: {seg.get('description', 'N/A')}\n")
                    for j, shot in enumerate(seg.get('shots', []), 1):
                        f.write(f"  镜头 {j}: {shot.get('name', 'Unnamed')}\n")
                        f.write(f"    时长: {shot.get('duration', 5)}秒\n")
                        f.write(f"    描述: {shot.get('description', 'N/A')}\n")

            if failed_records:
                failed_file = os.path.join(project_dir, "导出失败列表.txt")
                with open(failed_file, "w", encoding="utf-8") as f:
                    f.write("以下素材下载失败（可能是链接过期/跨域/网络问题），请在项目内重新生成或替换后再导出。\n\n")
                    for rec in failed_records:
                        f.write(f"[{rec.get('type')}] {rec.get('name')}\n")
                        f.write(f"URL: {rec.get('url')}\n")
                        f.write(f"错误: {rec.get('error')}\n\n")
            
            # 打包成 ZIP
            zip_filename = f"{safe_project_name}_{project_id}.zip"
            zip_path = os.path.join(self.output_dir, zip_filename)
            
            with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
                for root, dirs, files in os.walk(project_dir):
                    for file in files:
                        file_path = os.path.join(root, file)
                        arcname = os.path.relpath(file_path, temp_dir)
                        zipf.write(file_path, arcname)
            
            print(f"[ExportService] 项目素材已打包: {zip_path}")
            return zip_path
            
        finally:
            # 清理临时目录
            shutil.rmtree(temp_dir, ignore_errors=True)
    
    async def export_merged_video(
        self,
        project_id: str,
        project_name: str,
        segments: List[Any],
        output_resolution: str = "720p"
    ) -> str:
        """
        拼接所有视频片段并导出
        
        Args:
            project_id: 项目ID
            project_name: 项目名称
            segments: 分镜段落列表
            output_resolution: 输出分辨率 (720p/1080p)
        
        Returns:
            拼接后的视频文件路径
        """
        print(f"[ExportService] 开始拼接视频: {project_name}")
        
        # 检查 FFmpeg
        if not self._check_ffmpeg():
            raise Exception("FFmpeg 未安装，请先安装 FFmpeg")
        
        # 创建临时目录
        temp_dir = tempfile.mkdtemp()
        
        try:
            # 收集所有视频 URL（同时保留镜头时长与人声轨 URL，便于后续混音）
            video_urls = []
            for seg in segments:
                for shot in seg.get('shots', []):
                    if shot.get('video_url'):
                        video_urls.append({
                            'url': shot['video_url'],
                            'name': shot.get('name', shot.get('id', 'unknown')),
                            'duration': shot.get('duration', 5),
                            'voice_audio_url': shot.get('voice_audio_url'),
                            'voice_audio_duration_ms': shot.get('voice_audio_duration_ms')
                        })
            
            if not video_urls:
                raise Exception("没有可导出的视频片段")
            
            print(f"[ExportService] 找到 {len(video_urls)} 个视频片段")
            
            # 下载所有视频到临时目录
            video_files = []
            for i, video_info in enumerate(video_urls):
                filename = f"video_{i:03d}.mp4"
                filepath = os.path.join(temp_dir, filename)
                await self._download_file(video_info['url'], filepath)
                video_files.append(filepath)
                print(f"[ExportService] 已下载: {video_info['name']}")

            def _probe_duration_sec(media_path: str) -> float:
                try:
                    p = subprocess.run(
                        [
                            "ffprobe",
                            "-v",
                            "error",
                            "-show_entries",
                            "format=duration",
                            "-of",
                            "default=noprint_wrappers=1:nokey=1",
                            media_path,
                        ],
                        stdout=subprocess.PIPE,
                        stderr=subprocess.PIPE,
                        timeout=10,
                    )
                    if p.returncode == 0:
                        out = p.stdout.decode("utf-8", errors="ignore").strip()
                        if out:
                            return float(out)
                except Exception:
                    pass
                return 0.0

            def _has_audio_stream(video_path: str) -> bool:
                try:
                    p = subprocess.run(
                        [
                            "ffprobe",
                            "-v",
                            "error",
                            "-select_streams",
                            "a",
                            "-show_entries",
                            "stream=index",
                            "-of",
                            "csv=p=0",
                            video_path,
                        ],
                        stdout=subprocess.PIPE,
                        stderr=subprocess.PIPE,
                        timeout=10,
                    )
                    return p.returncode == 0 and bool(p.stdout.decode("utf-8", errors="ignore").strip())
                except Exception:
                    return False
            
            # 创建 FFmpeg concat 文件（注意：后续可能会对 video_files 做预处理替换，因此会在拼接前再次写入）
            concat_file = os.path.join(temp_dir, "concat.txt")
            
            # 输出文件路径
            output_filename = f"{project_name}_{project_id}_merged.mp4"
            output_path = os.path.join(self.output_dir, output_filename)
            
            # 设置分辨率
            scale_filter = ""
            if output_resolution == "1080p":
                scale_filter = "-vf scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2"
            elif output_resolution == "720p":
                scale_filter = "-vf scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2"

            # 如果有独立人声轨（旁白/对白），优先保证“念完不截断”：必要时自动延长对应视频段（定格最后一帧）。
            has_voice_tracks = any(v.get("voice_audio_url") for v in video_urls)
            if has_voice_tracks:
                try:
                    for i, v in enumerate(video_urls):
                        voice_url = v.get("voice_audio_url")
                        if not voice_url:
                            v["voice_sec"] = 0.0
                            continue
                        ext = os.path.splitext(urllib.parse.urlparse(voice_url).path or "")[1] or ".mp3"
                        voice_in = os.path.join(temp_dir, f"voice_in_{i:03d}{ext}")
                        await self._download_file(voice_url, voice_in)
                        v["voice_in_path"] = voice_in
                        v["voice_sec"] = float(_probe_duration_sec(voice_in) or 0.0)

                    processed_files = []
                    for i, video_file in enumerate(video_files):
                        v = video_urls[i]
                        base_sec = float(v.get("duration") or 5)
                        voice_sec = float(v.get("voice_sec") or 0.0)
                        target_sec = max(base_sec, voice_sec) if voice_sec > 0 else base_sec
                        v["export_duration_sec"] = target_sec

                        raw_sec = float(_probe_duration_sec(video_file) or 0.0)
                        if raw_sec <= 0:
                            raw_sec = base_sec

                        pad_sec = max(0.0, target_sec - raw_sec)
                        vf = ""
                        if scale_filter:
                            # scale_filter 形如 "-vf xxx"，这里只取滤镜表达式
                            vf = " ".join(scale_filter.split()[1:])
                        if pad_sec > 0.05:
                            vf = f"{vf},{'tpad=stop_mode=clone:stop_duration=' + format(pad_sec, '.3f')}" if vf else f"tpad=stop_mode=clone:stop_duration={pad_sec:.3f}"

                        out_file = os.path.join(temp_dir, f"video_proc_{i:03d}.mp4")
                        has_audio = _has_audio_stream(video_file)

                        if has_audio:
                            cmd_fix = [
                                "ffmpeg",
                                "-y",
                                "-i",
                                video_file,
                            ]
                            if vf:
                                cmd_fix += ["-vf", vf]
                            cmd_fix += [
                                "-af",
                                f"apad,atrim=0:{target_sec:.3f}",
                                "-t",
                                f"{target_sec:.3f}",
                                "-c:v",
                                "libx264",
                                "-preset",
                                "veryfast",
                                "-crf",
                                "23",
                                "-pix_fmt",
                                "yuv420p",
                                "-c:a",
                                "aac",
                                "-b:a",
                                "128k",
                                "-ar",
                                "48000",
                                "-ac",
                                "2",
                                out_file,
                            ]
                        else:
                            cmd_fix = [
                                "ffmpeg",
                                "-y",
                                "-i",
                                video_file,
                                "-f",
                                "lavfi",
                                "-i",
                                "anullsrc=r=48000:cl=stereo",
                            ]
                            if vf:
                                cmd_fix += ["-vf", vf]
                            cmd_fix += [
                                "-map",
                                "0:v",
                                "-map",
                                "1:a",
                                "-t",
                                f"{target_sec:.3f}",
                                "-c:v",
                                "libx264",
                                "-preset",
                                "veryfast",
                                "-crf",
                                "23",
                                "-pix_fmt",
                                "yuv420p",
                                "-c:a",
                                "aac",
                                "-b:a",
                                "128k",
                                "-ar",
                                "48000",
                                "-ac",
                                "2",
                                out_file,
                            ]

                        p = subprocess.run(cmd_fix, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                        if p.returncode != 0:
                            raise Exception(p.stderr.decode("utf-8", errors="ignore")[:2000])
                        processed_files.append(out_file)

                    video_files = processed_files
                    # 已在分段处理里做了 scale，拼接阶段不再重复缩放
                    scale_filter = ""
                except Exception as e:
                    print(f"[ExportService] 预处理视频段（为人声延时）失败：{e}（将回退到原始拼接逻辑）")

            # 使用 FFmpeg 拼接视频（重新写入 concat 文件：video_files 可能已被预处理替换）
            with open(concat_file, 'w', encoding='utf-8') as f:
                for video_file in video_files:
                    escaped_path = video_file.replace('\\', '/').replace("'", "'\\''")
                    f.write(f"file '{escaped_path}'\n")

            cmd = [
                'ffmpeg',
                '-f', 'concat',
                '-safe', '0',
                '-i', concat_file,
                '-y'  # 覆盖已存在的文件
            ]
            
            if scale_filter:
                cmd.extend(['-c:v', 'libx264', '-preset', 'medium', '-crf', '23', '-c:a', 'aac', '-b:a', '128k'])
                cmd.extend(scale_filter.split())
            else:
                # 预处理后视频段参数一致，优先无损拼接
                cmd.extend(['-c', 'copy'])
            
            cmd.append(output_path)
            
            print(f"[ExportService] 执行 FFmpeg 命令: {' '.join(cmd)}")
            
            # 执行 FFmpeg
            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            
            stdout, stderr = await process.communicate()

            if process.returncode != 0:
                error_msg = stderr.decode('utf-8', errors='ignore')
                # 如果是 copy 拼接失败，回退到重编码拼接（更兼容）
                if '-c' in cmd and 'copy' in cmd:
                    print(f"[ExportService] copy 拼接失败，回退到重编码: {error_msg}")
                    cmd_fallback = [
                        'ffmpeg',
                        '-f', 'concat',
                        '-safe', '0',
                        '-i', concat_file,
                        '-c:v', 'libx264',
                        '-preset', 'medium',
                        '-crf', '23',
                        '-c:a', 'aac',
                        '-b:a', '128k',
                        '-y',
                        output_path
                    ]
                    process = await asyncio.create_subprocess_exec(
                        *cmd_fallback,
                        stdout=asyncio.subprocess.PIPE,
                        stderr=asyncio.subprocess.PIPE
                    )
                    _, stderr2 = await process.communicate()
                    if process.returncode != 0:
                        error_msg2 = stderr2.decode('utf-8', errors='ignore')
                        print(f"[ExportService] FFmpeg 错误: {error_msg2}")
                        raise Exception(f"视频拼接失败: {error_msg2}")
                else:
                    print(f"[ExportService] FFmpeg 错误: {error_msg}")
                    raise Exception(f"视频拼接失败: {error_msg}")
            
            # 如果有独立人声轨（旁白/对白），将其叠加到视频原音轨（保留环境音/音效）
            if any(v.get("voice_audio_url") for v in video_urls):
                try:
                    voice_all = os.path.join(temp_dir, "voice_all.wav")

                    voice_seg_files = []
                    for i, v in enumerate(video_urls):
                        shot_sec = float(v.get("export_duration_sec") or v.get("duration") or 5)
                        seg_out = os.path.join(temp_dir, f"voice_seg_{i:03d}.wav")

                        if v.get("voice_audio_url"):
                            voice_in = v.get("voice_in_path")
                            if not voice_in or not os.path.exists(voice_in):
                                ext = os.path.splitext(urllib.parse.urlparse(v["voice_audio_url"]).path or "")[1] or ".mp3"
                                voice_in = os.path.join(temp_dir, f"voice_in_{i:03d}{ext}")
                                await self._download_file(v["voice_audio_url"], voice_in)

                            filters = []
                            filters.append("apad")
                            filters.append(f"atrim=0:{shot_sec:.3f}")

                            cmd_voice = [
                                "ffmpeg",
                                "-y",
                                "-i",
                                voice_in,
                                "-af",
                                ",".join(filters),
                                "-t",
                                f"{shot_sec:.3f}",
                                "-ar",
                                "48000",
                                "-ac",
                                "2",
                                seg_out,
                            ]
                            p = subprocess.run(cmd_voice, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                            if p.returncode != 0:
                                raise Exception(p.stderr.decode("utf-8", errors="ignore")[:2000])
                        else:
                            cmd_silence = [
                                "ffmpeg",
                                "-y",
                                "-f",
                                "lavfi",
                                "-i",
                                "anullsrc=r=48000:cl=stereo",
                                "-t",
                                f"{shot_sec:.3f}",
                                seg_out,
                            ]
                            p = subprocess.run(cmd_silence, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                            if p.returncode != 0:
                                raise Exception(p.stderr.decode("utf-8", errors="ignore")[:2000])

                        voice_seg_files.append(seg_out)

                    concat_voice = os.path.join(temp_dir, "voice_concat.txt")
                    with open(concat_voice, "w", encoding="utf-8") as f:
                        for vf in voice_seg_files:
                            escaped = vf.replace("\\", "/").replace("'", "'\\''")
                            f.write(f"file '{escaped}'\n")

                    cmd_concat_audio = [
                        "ffmpeg",
                        "-y",
                        "-f",
                        "concat",
                        "-safe",
                        "0",
                        "-i",
                        concat_voice,
                        "-c",
                        "copy",
                        voice_all,
                    ]
                    p = subprocess.run(cmd_concat_audio, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                    if p.returncode != 0:
                        cmd_concat_audio = [
                            "ffmpeg",
                            "-y",
                            "-f",
                            "concat",
                            "-safe",
                            "0",
                            "-i",
                            concat_voice,
                            "-c:a",
                            "pcm_s16le",
                            voice_all,
                        ]
                        p = subprocess.run(cmd_concat_audio, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                        if p.returncode != 0:
                            raise Exception(p.stderr.decode("utf-8", errors="ignore")[:2000])

                    mixed_path = os.path.join(self.output_dir, f"{project_name}_{project_id}_merged_with_voice.mp4")

                    def _has_audio_stream(video_path: str) -> bool:
                        try:
                            p = subprocess.run(
                                [
                                    "ffprobe",
                                    "-v",
                                    "error",
                                    "-select_streams",
                                    "a",
                                    "-show_entries",
                                    "stream=index",
                                    "-of",
                                    "csv=p=0",
                                    video_path,
                                ],
                                stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE,
                                timeout=5,
                            )
                            return p.returncode == 0 and bool(p.stdout.decode("utf-8", errors="ignore").strip())
                        except Exception:
                            pass
                        try:
                            p = subprocess.run(
                                ["ffmpeg", "-hide_banner", "-i", video_path],
                                stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE,
                                timeout=5,
                            )
                            txt = p.stderr.decode("utf-8", errors="ignore")
                            return "Audio:" in txt
                        except Exception:
                            return False

                    if _has_audio_stream(output_path):
                        filter_complex = (
                            "[0:a][1:a]sidechaincompress=threshold=0.02:ratio=8:attack=20:release=300[bg];"
                            "[bg][1:a]amix=inputs=2:duration=first:dropout_transition=2[aout]"
                        )
                        cmd_mix = [
                            "ffmpeg",
                            "-y",
                            "-i",
                            output_path,
                            "-i",
                            voice_all,
                            "-filter_complex",
                            filter_complex,
                            "-map",
                            "0:v",
                            "-map",
                            "[aout]",
                            "-c:v",
                            "copy",
                            "-c:a",
                            "aac",
                            "-b:a",
                            "192k",
                            "-shortest",
                            mixed_path,
                        ]
                    else:
                        # 原视频没有音轨：直接把人声作为输出音轨（voice_all 已按镜头时长补齐）
                        cmd_mix = [
                            "ffmpeg",
                            "-y",
                            "-i",
                            output_path,
                            "-i",
                            voice_all,
                            "-map",
                            "0:v",
                            "-map",
                            "1:a",
                            "-c:v",
                            "copy",
                            "-c:a",
                            "aac",
                            "-b:a",
                            "192k",
                            "-shortest",
                            mixed_path,
                        ]
                    p = subprocess.run(cmd_mix, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                    if p.returncode != 0:
                        raise Exception(p.stderr.decode("utf-8", errors="ignore")[:2000])

                    print(f"[ExportService] 视频拼接+人声混音完成: {mixed_path}")
                    return mixed_path
                except Exception as e:
                    print(f"[ExportService] 人声混音失败（将返回仅拼接视频）: {e}")

            print(f"[ExportService] 视频拼接完成: {output_path}")
            return output_path
            
        finally:
            # 清理临时目录
            shutil.rmtree(temp_dir, ignore_errors=True)
    
    def _resolve_local_path(self, url: str) -> Optional[str]:
        parsed = urllib.parse.urlparse(url)
        path = urllib.parse.unquote(parsed.path or "")

        base_dir = os.path.dirname(os.path.dirname(__file__))

        # file:// URLs
        if parsed.scheme == "file":
            file_path = path
            if os.name == "nt" and file_path.startswith("/") and len(file_path) >= 3 and file_path[2] == ":":
                file_path = file_path[1:]
            return file_path

        is_local_http = parsed.scheme in ("http", "https") and (parsed.hostname in ("localhost", "127.0.0.1"))
        is_local_path = parsed.scheme == "" and path.startswith("/api/")
        if not (is_local_http or is_local_path):
            return None

        if path.startswith("/api/images/ref/"):
            filename = path[len("/api/images/ref/"):]
            filename = os.path.basename(filename)
            return os.path.join(base_dir, "data", "images", filename)

        if path.startswith("/api/videos/ref/"):
            filename = path[len("/api/videos/ref/"):]
            filename = os.path.basename(filename)
            return os.path.join(base_dir, "data", "videos", filename)

        if path.startswith("/api/uploads/"):
            rest = path[len("/api/uploads/"):].replace("/", os.sep)
            rest = os.path.normpath(rest).lstrip("\\/")
            candidate = os.path.abspath(os.path.join(base_dir, "uploads", rest))
            uploads_root = os.path.abspath(os.path.join(base_dir, "uploads"))
            if candidate.startswith(uploads_root + os.sep) or candidate == uploads_root:
                return candidate
            return None

        if path.startswith("/api/"):
            rest = path[len("/api/"):].replace("/", os.sep)
            rest = os.path.normpath(rest).lstrip("\\/")
            candidate = os.path.abspath(os.path.join(base_dir, "data", rest))
            data_root = os.path.abspath(os.path.join(base_dir, "data"))
            if candidate.startswith(data_root + os.sep) or candidate == data_root:
                return candidate

        return None

    async def _download_file(self, url: str, filepath: str):
        """下载文件"""
        # data: URL（base64）
        if url.startswith("data:"):
            try:
                header, data = url.split(",", 1)
                if ";base64" in header:
                    raw = base64.b64decode(data)
                    with open(filepath, "wb") as f:
                        f.write(raw)
                    return
            except Exception:
                pass

        # 如果是本地 URL，直接复制文件，避免走 http
        local_path = self._resolve_local_path(url)
        if local_path and os.path.exists(local_path):
            shutil.copy2(local_path, filepath)
            return
        
        # 下载远程文件
        async with httpx.AsyncClient(timeout=60.0, follow_redirects=True) as client:
            async with client.stream("GET", url) as response:
                if response.status_code != 200:
                    raise Exception(f"下载失败: {url} (status: {response.status_code})")
                with open(filepath, "wb") as f:
                    async for chunk in response.aiter_bytes():
                        f.write(chunk)
    
    def _check_ffmpeg(self) -> bool:
        """检查 FFmpeg 是否可用"""
        try:
            result = subprocess.run(
                ['ffmpeg', '-version'],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=5
            )
            return result.returncode == 0
        except (FileNotFoundError, subprocess.TimeoutExpired):
            return False


# 全局实例
export_service = ExportService()
