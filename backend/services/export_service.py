"""
导出服务
支持导出项目素材和拼接视频
"""
import os
import zipfile
import subprocess
import tempfile
import shutil
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
        project_dir = os.path.join(temp_dir, project_name)
        os.makedirs(project_dir, exist_ok=True)
        
        try:
            # 创建分类目录
            elements_dir = os.path.join(project_dir, "1_角色元素")
            frames_dir = os.path.join(project_dir, "2_镜头起始帧")
            videos_dir = os.path.join(project_dir, "3_视频片段")
            os.makedirs(elements_dir, exist_ok=True)
            os.makedirs(frames_dir, exist_ok=True)
            os.makedirs(videos_dir, exist_ok=True)
            
            # 下载角色元素图片
            element_count = 0
            for elem_id, elem in elements.items():
                if elem.get('image_url'):
                    filename = f"{elem.get('name', elem_id)}.png"
                    filepath = os.path.join(elements_dir, filename)
                    await self._download_file(elem['image_url'], filepath)
                    element_count += 1
                    print(f"[ExportService] 已下载角色: {filename}")
            
            # 下载镜头起始帧和视频
            frame_count = 0
            video_count = 0
            for seg in segments:
                for shot in seg.get('shots', []):
                    shot_name = shot.get('name', shot.get('id', 'unknown'))
                    
                    # 起始帧
                    if shot.get('start_frame_url'):
                        filename = f"{shot_name}_frame.png"
                        filepath = os.path.join(frames_dir, filename)
                        await self._download_file(shot['start_frame_url'], filepath)
                        frame_count += 1
                        print(f"[ExportService] 已下载起始帧: {filename}")
                    
                    # 视频
                    if shot.get('video_url'):
                        filename = f"{shot_name}.mp4"
                        filepath = os.path.join(videos_dir, filename)
                        await self._download_file(shot['video_url'], filepath)
                        video_count += 1
                        print(f"[ExportService] 已下载视频: {filename}")
            
            # 创建项目信息文件
            info_file = os.path.join(project_dir, "项目信息.txt")
            with open(info_file, 'w', encoding='utf-8') as f:
                f.write(f"项目名称: {project_name}\n")
                f.write(f"项目ID: {project_id}\n")
                f.write(f"\n=== 素材统计 ===\n")
                f.write(f"角色元素: {element_count} 个\n")
                f.write(f"镜头起始帧: {frame_count} 个\n")
                f.write(f"视频片段: {video_count} 个\n")
                f.write(f"\n=== 分镜列表 ===\n")
                for i, seg in enumerate(segments, 1):
                    f.write(f"\n段落 {i}: {seg.get('name', 'Unnamed')}\n")
                    f.write(f"描述: {seg.get('description', 'N/A')}\n")
                    for j, shot in enumerate(seg.get('shots', []), 1):
                        f.write(f"  镜头 {j}: {shot.get('name', 'Unnamed')}\n")
                        f.write(f"    时长: {shot.get('duration', 5)}秒\n")
                        f.write(f"    描述: {shot.get('description', 'N/A')}\n")
            
            # 打包成 ZIP
            zip_filename = f"{project_name}_{project_id}.zip"
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
    
    async def _download_file(self, url: str, filepath: str):
        """下载文件"""
        # 如果是本地文件，直接复制
        if url.startswith('http://localhost') or url.startswith('http://127.0.0.1'):
            # 从 URL 提取本地路径
            import urllib.parse
            parsed = urllib.parse.urlparse(url)
            local_path = os.path.join(
                os.path.dirname(os.path.dirname(__file__)),
                'data',
                parsed.path.lstrip('/api/')
            )
            if os.path.exists(local_path):
                shutil.copy2(local_path, filepath)
                return
        
        # 下载远程文件
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(url)
            if response.status_code == 200:
                with open(filepath, 'wb') as f:
                    f.write(response.content)
            else:
                raise Exception(f"下载失败: {url} (status: {response.status_code})")
    
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
