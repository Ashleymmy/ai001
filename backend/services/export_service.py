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
            os.makedirs(elements_dir, exist_ok=True)
            os.makedirs(frames_dir, exist_ok=True)
            os.makedirs(videos_dir, exist_ok=True)
            
            # 下载角色元素图片
            element_count = 0
            failed_count = 0
            failed_records: List[Dict[str, str]] = []
            for elem_id, elem in elements.items():
                if elem.get('image_url'):
                    safe_name = sanitize_filename(elem.get('name', elem_id), fallback=str(elem_id))
                    filename = f"{safe_name}{infer_ext(elem['image_url'], '.png')}"
                    filepath = os.path.join(elements_dir, filename)
                    try:
                        await self._download_file(elem['image_url'], filepath)
                        element_count += 1
                        print(f"[ExportService] 已下载角色: {filename}")
                    except Exception as e:
                        failed_count += 1
                        failed_records.append({
                            "type": "element",
                            "name": str(elem.get("name") or elem_id),
                            "url": str(elem.get("image_url") or ""),
                            "error": str(e),
                        })
                        print(f"[ExportService] 角色下载失败: {filename} ({e})")
            
            # 下载镜头起始帧和视频
            frame_count = 0
            video_count = 0
            for seg in segments:
                for shot in seg.get('shots', []):
                    shot_name = shot.get('name', shot.get('id', 'unknown'))
                    safe_shot_name = sanitize_filename(shot_name, fallback=str(shot.get('id', 'unknown')))
                    shot_id = str(shot.get('id') or "")
                    unique_suffix = f"_{shot_id}" if shot_id and shot_id not in safe_shot_name else ""
                    
                    # 起始帧
                    start_frame_url = shot.get('start_image_url') or shot.get('start_frame_url')
                    if start_frame_url:
                        filename = f"{safe_shot_name}{unique_suffix}_frame{infer_ext(start_frame_url, '.png')}"
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
                        filename = f"{safe_shot_name}{unique_suffix}{infer_ext(shot['video_url'], '.mp4')}"
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
            
            # 创建项目信息文件
            info_file = os.path.join(project_dir, "项目信息.txt")
            with open(info_file, 'w', encoding='utf-8') as f:
                f.write(f"项目名称: {project_name}\n")
                f.write(f"项目ID: {project_id}\n")
                f.write(f"\n=== 素材统计 ===\n")
                f.write(f"角色元素: {element_count} 个\n")
                f.write(f"镜头起始帧: {frame_count} 个\n")
                f.write(f"视频片段: {video_count} 个\n")
                f.write(f"下载失败: {failed_count} 个\n")
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
            # 收集所有视频 URL
            video_urls = []
            for seg in segments:
                for shot in seg.get('shots', []):
                    if shot.get('video_url'):
                        video_urls.append({
                            'url': shot['video_url'],
                            'name': shot.get('name', shot.get('id', 'unknown'))
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
            
            # 创建 FFmpeg concat 文件
            concat_file = os.path.join(temp_dir, "concat.txt")
            with open(concat_file, 'w', encoding='utf-8') as f:
                for video_file in video_files:
                    # FFmpeg concat 需要转义路径
                    escaped_path = video_file.replace('\\', '/').replace("'", "'\\''")
                    f.write(f"file '{escaped_path}'\n")
            
            # 输出文件路径
            output_filename = f"{project_name}_{project_id}_merged.mp4"
            output_path = os.path.join(self.output_dir, output_filename)
            
            # 设置分辨率
            scale_filter = ""
            if output_resolution == "1080p":
                scale_filter = "-vf scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2"
            elif output_resolution == "720p":
                scale_filter = "-vf scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2"
            
            # 使用 FFmpeg 拼接视频
            cmd = [
                'ffmpeg',
                '-f', 'concat',
                '-safe', '0',
                '-i', concat_file,
                '-c:v', 'libx264',
                '-preset', 'medium',
                '-crf', '23',
                '-c:a', 'aac',
                '-b:a', '128k',
                '-y'  # 覆盖已存在的文件
            ]
            
            if scale_filter:
                cmd.extend(scale_filter.split())
            
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
                print(f"[ExportService] FFmpeg 错误: {error_msg}")
                raise Exception(f"视频拼接失败: {error_msg}")
            
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
