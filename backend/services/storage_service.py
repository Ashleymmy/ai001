"""本地存储服务 - 使用 YAML 文件，支持历史记录和数据迁移"""
import os
import shutil
import zipfile
import uuid
from datetime import datetime
from typing import Optional, List, Dict, Any
import yaml
import json

# 数据目录
DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")
PROJECTS_DIR = os.path.join(DATA_DIR, "projects")
SCRIPTS_DIR = os.path.join(DATA_DIR, "scripts")
IMAGES_DIR = os.path.join(DATA_DIR, "images")
CHAT_DIR = os.path.join(DATA_DIR, "chat")
EXPORT_DIR = os.path.join(DATA_DIR, "exports")
SETTINGS_FILE = os.path.join(DATA_DIR, "settings.yaml")

# 确保目录存在
for d in [DATA_DIR, PROJECTS_DIR, SCRIPTS_DIR, IMAGES_DIR, CHAT_DIR, EXPORT_DIR]:
    os.makedirs(d, exist_ok=True)


def _load_yaml(filepath: str) -> Dict:
    """加载 YAML 文件"""
    if os.path.exists(filepath):
        with open(filepath, 'r', encoding='utf-8') as f:
            return yaml.safe_load(f) or {}
    return {}


def _save_yaml(filepath: str, data: Dict):
    """保存 YAML 文件"""
    with open(filepath, 'w', encoding='utf-8') as f:
        yaml.dump(data, f, allow_unicode=True, default_flow_style=False, sort_keys=False)


def _now() -> str:
    return datetime.now().isoformat()


def _gen_id() -> str:
    return str(uuid.uuid4())[:8]


class StorageService:
    """YAML 文件存储服务 - 支持历史记录和数据迁移"""
    
    # ==================== 设置管理 ====================
    
    def save_settings(self, settings: Dict[str, Any]) -> Dict[str, Any]:
        """保存设置"""
        settings['updated_at'] = _now()
        _save_yaml(SETTINGS_FILE, settings)
        return settings
    
    def get_settings(self) -> Optional[Dict[str, Any]]:
        """获取设置"""
        if os.path.exists(SETTINGS_FILE):
            return _load_yaml(SETTINGS_FILE)
        return None
    
    # ==================== 项目管理 ====================
    
    def _project_file(self, project_id: str) -> str:
        return os.path.join(PROJECTS_DIR, f"{project_id}.yaml")
    
    def create_project(self, name: str, description: str = "") -> Dict[str, Any]:
        """创建新项目"""
        project_id = _gen_id()
        now = _now()
        
        project = {
            "id": project_id,
            "name": name,
            "description": description,
            "reference_image": None,
            "story_text": "",
            "style": "cinematic",
            "status": "draft",
            "storyboards": [],
            "created_at": now,
            "updated_at": now,
            "history": [{
                "action": "created",
                "timestamp": now,
                "data": {"name": name}
            }]
        }
        
        _save_yaml(self._project_file(project_id), project)
        return project
    
    def get_project(self, project_id: str) -> Optional[Dict[str, Any]]:
        """获取项目详情"""
        filepath = self._project_file(project_id)
        if not os.path.exists(filepath):
            return None
        return _load_yaml(filepath)
    
    def list_projects(self, limit: int = 50, offset: int = 0) -> List[Dict[str, Any]]:
        """获取项目列表"""
        projects = []
        if not os.path.exists(PROJECTS_DIR):
            return []
        for filename in os.listdir(PROJECTS_DIR):
            if filename.endswith('.yaml'):
                project = _load_yaml(os.path.join(PROJECTS_DIR, filename))
                if project:
                    # 返回简要信息，不包含完整历史
                    projects.append({
                        "id": project.get("id"),
                        "name": project.get("name"),
                        "description": project.get("description"),
                        "style": project.get("style"),
                        "status": project.get("status"),
                        "storyboard_count": len(project.get("storyboards", [])),
                        "created_at": project.get("created_at"),
                        "updated_at": project.get("updated_at")
                    })
        
        projects.sort(key=lambda x: x.get('updated_at', ''), reverse=True)
        return projects[offset:offset + limit]
    
    def update_project(self, project_id: str, updates: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """更新项目"""
        project = self.get_project(project_id)
        if not project:
            return None
        
        allowed_fields = ['name', 'description', 'reference_image', 'story_text', 'style', 'status']
        changes = {}
        for key, value in updates.items():
            if key in allowed_fields and project.get(key) != value:
                changes[key] = {"old": project.get(key), "new": value}
                project[key] = value
        
        if changes:
            now = _now()
            project['updated_at'] = now
            if 'history' not in project:
                project['history'] = []
            project['history'].append({
                "action": "updated",
                "timestamp": now,
                "changes": changes
            })
            _save_yaml(self._project_file(project_id), project)
        
        return project
    
    def delete_project(self, project_id: str) -> bool:
        """删除项目"""
        filepath = self._project_file(project_id)
        if os.path.exists(filepath):
            os.remove(filepath)
            return True
        return False
    
    def get_project_history(self, project_id: str) -> List[Dict[str, Any]]:
        """获取项目历史记录"""
        project = self.get_project(project_id)
        if not project:
            return []
        return project.get('history', [])
    
    # ==================== 分镜管理 ====================
    
    def add_storyboard(self, project_id: str, prompt: str, full_prompt: str = "", 
                       image_url: str = "", index: int = -1) -> Optional[Dict[str, Any]]:
        """添加分镜"""
        project = self.get_project(project_id)
        if not project:
            return None
        
        storyboard_id = _gen_id()
        now = _now()
        
        storyboard = {
            "id": storyboard_id,
            "project_id": project_id,
            "index_num": len(project.get('storyboards', [])) + 1 if index < 0 else index,
            "prompt": prompt,
            "full_prompt": full_prompt,
            "image_url": image_url,
            "status": "done" if image_url else "pending",
            "created_at": now,
            "updated_at": now
        }
        
        if 'storyboards' not in project:
            project['storyboards'] = []
        project['storyboards'].append(storyboard)
        project['updated_at'] = now
        
        if 'history' not in project:
            project['history'] = []
        project['history'].append({
            "action": "storyboard_added",
            "timestamp": now,
            "data": {"storyboard_id": storyboard_id, "prompt": prompt[:50]}
        })
        
        _save_yaml(self._project_file(project_id), project)
        return storyboard
    
    def update_storyboard(self, project_id: str, storyboard_id: str, updates: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """更新分镜"""
        project = self.get_project(project_id)
        if not project:
            return None
        
        allowed_fields = ['prompt', 'full_prompt', 'image_url', 'status', 'index_num']
        updated_sb = None
        
        for sb in project.get('storyboards', []):
            if sb.get('id') == storyboard_id:
                for key, value in updates.items():
                    if key in allowed_fields:
                        sb[key] = value
                sb['updated_at'] = _now()
                updated_sb = sb
                break
        
        if updated_sb:
            project['updated_at'] = _now()
            _save_yaml(self._project_file(project_id), project)
        
        return updated_sb
    
    def delete_storyboard(self, project_id: str, storyboard_id: str) -> bool:
        """删除分镜"""
        project = self.get_project(project_id)
        if not project:
            return False
        
        original_len = len(project.get('storyboards', []))
        project['storyboards'] = [sb for sb in project.get('storyboards', []) if sb.get('id') != storyboard_id]
        
        if len(project['storyboards']) < original_len:
            now = _now()
            project['updated_at'] = now
            if 'history' not in project:
                project['history'] = []
            project['history'].append({
                "action": "storyboard_deleted",
                "timestamp": now,
                "data": {"storyboard_id": storyboard_id}
            })
            _save_yaml(self._project_file(project_id), project)
            return True
        return False
    
    # ==================== 剧本管理 ====================
    
    def _script_file(self, script_id: str) -> str:
        return os.path.join(SCRIPTS_DIR, f"{script_id}.yaml")
    
    def save_script(self, title: str, content: str, project_id: str = None) -> Dict[str, Any]:
        """保存剧本"""
        script_id = _gen_id()
        now = _now()
        
        script = {
            "id": script_id,
            "project_id": project_id,
            "title": title,
            "content": content,
            "version": 1,
            "created_at": now,
            "updated_at": now,
            "history": [{
                "action": "created",
                "timestamp": now,
                "version": 1,
                "content_length": len(content)
            }]
        }
        
        _save_yaml(self._script_file(script_id), script)
        return script
    
    def get_script(self, script_id: str) -> Optional[Dict[str, Any]]:
        """获取剧本"""
        filepath = self._script_file(script_id)
        if not os.path.exists(filepath):
            return None
        return _load_yaml(filepath)
    
    def list_scripts(self, project_id: str = None, limit: int = 50) -> List[Dict[str, Any]]:
        """获取剧本列表"""
        scripts = []
        if not os.path.exists(SCRIPTS_DIR):
            return []
        for filename in os.listdir(SCRIPTS_DIR):
            if filename.endswith('.yaml'):
                script = _load_yaml(os.path.join(SCRIPTS_DIR, filename))
                if script:
                    if project_id is None or script.get('project_id') == project_id:
                        scripts.append({
                            "id": script.get("id"),
                            "project_id": script.get("project_id"),
                            "title": script.get("title"),
                            "content": script.get("content", ""),
                            "version": script.get("version"),
                            "created_at": script.get("created_at"),
                            "updated_at": script.get("updated_at")
                        })
        
        scripts.sort(key=lambda x: x.get('updated_at', ''), reverse=True)
        return scripts[:limit]
    
    def update_script(self, script_id: str, title: str = None, content: str = None) -> Optional[Dict[str, Any]]:
        """更新剧本（保留版本历史）"""
        script = self.get_script(script_id)
        if not script:
            return None
        
        now = _now()
        changes = {}
        
        if title is not None and title != script.get('title'):
            changes['title'] = {"old": script.get('title'), "new": title}
            script['title'] = title
        
        if content is not None and content != script.get('content'):
            script['version'] = script.get('version', 1) + 1
            changes['content'] = {"old_length": len(script.get('content', '')), "new_length": len(content)}
            script['content'] = content
        
        if changes:
            script['updated_at'] = now
            if 'history' not in script:
                script['history'] = []
            script['history'].append({
                "action": "updated",
                "timestamp": now,
                "version": script.get('version'),
                "changes": changes
            })
            _save_yaml(self._script_file(script_id), script)
        
        return script
    
    def delete_script(self, script_id: str) -> bool:
        """删除剧本"""
        filepath = self._script_file(script_id)
        if os.path.exists(filepath):
            os.remove(filepath)
            return True
        return False
    
    def get_script_history(self, script_id: str) -> List[Dict[str, Any]]:
        """获取剧本历史"""
        script = self.get_script(script_id)
        if not script:
            return []
        return script.get('history', [])
    
    # ==================== 图像历史 ====================
    
    def _images_index_file(self) -> str:
        return os.path.join(IMAGES_DIR, "index.yaml")
    
    def save_generated_image(self, prompt: str, image_url: str, 
                             negative_prompt: str = "", provider: str = "", model: str = "",
                             width: int = 1024, height: int = 576, steps: int = 25,
                             seed: int = 0, style: str = None) -> Dict[str, Any]:
        """保存生成的图像记录"""
        index = _load_yaml(self._images_index_file())
        if 'images' not in index:
            index['images'] = []
        
        image_id = _gen_id()
        now = _now()
        
        image_record = {
            "id": image_id,
            "prompt": prompt,
            "negative_prompt": negative_prompt,
            "image_url": image_url,
            "provider": provider,
            "model": model,
            "width": width,
            "height": height,
            "steps": steps,
            "seed": seed,
            "style": style,
            "created_at": now
        }
        
        index['images'].insert(0, image_record)
        index['images'] = index['images'][:1000]  # 保留最近 1000 条
        index['updated_at'] = now
        
        _save_yaml(self._images_index_file(), index)
        return image_record
    
    def list_generated_images(self, limit: int = 100, offset: int = 0) -> List[Dict[str, Any]]:
        """获取图像历史"""
        index = _load_yaml(self._images_index_file())
        images = index.get('images', [])
        return images[offset:offset + limit]
    
    def delete_generated_image(self, image_id: str) -> bool:
        """删除图像历史记录"""
        index = _load_yaml(self._images_index_file())
        images = index.get('images', [])
        
        original_len = len(images)
        index['images'] = [img for img in images if img.get('id') != image_id]
        
        if len(index['images']) < original_len:
            index['updated_at'] = _now()
            _save_yaml(self._images_index_file(), index)
            return True
        return False
    
    def delete_generated_images_batch(self, image_ids: List[str]) -> int:
        """批量删除图像历史记录"""
        index = _load_yaml(self._images_index_file())
        images = index.get('images', [])
        
        ids_set = set(image_ids)
        original_len = len(images)
        index['images'] = [img for img in images if img.get('id') not in ids_set]
        
        deleted_count = original_len - len(index['images'])
        if deleted_count > 0:
            index['updated_at'] = _now()
            _save_yaml(self._images_index_file(), index)
        
        return deleted_count
    
    def get_image_stats(self) -> Dict[str, Any]:
        """获取图像生成统计"""
        index = _load_yaml(self._images_index_file())
        images = index.get('images', [])
        
        providers = {}
        for img in images:
            p = img.get('provider', 'unknown')
            providers[p] = providers.get(p, 0) + 1
        
        return {
            "total": len(images),
            "by_provider": providers
        }
    
    # ==================== 视频历史 ====================
    
    def _videos_index_file(self) -> str:
        return os.path.join(IMAGES_DIR, "videos_index.yaml")
    
    def save_generated_video(self, source_image: str, prompt: str,
                             video_url: str = None, task_id: str = "",
                             status: str = "processing", provider: str = "",
                             model: str = "", duration: float = 5.0,
                             seed: int = 0) -> Dict[str, Any]:
        """保存生成的视频记录"""
        index = _load_yaml(self._videos_index_file())
        if 'videos' not in index:
            index['videos'] = []
        
        video_id = _gen_id()
        now = _now()
        
        # 保存源图片到文件
        saved_source_image = ""
        if source_image:
            if source_image.startswith('data:image'):
                # base64 图片，保存到文件
                try:
                    import base64
                    # 解析 base64
                    if ',' in source_image:
                        header, data = source_image.split(',', 1)
                        ext = 'png'
                        if 'jpeg' in header or 'jpg' in header:
                            ext = 'jpg'
                        elif 'webp' in header:
                            ext = 'webp'
                    else:
                        data = source_image
                        ext = 'png'
                    
                    # 保存文件
                    filename = f"video_src_{video_id}.{ext}"
                    filepath = os.path.join(IMAGES_DIR, filename)
                    with open(filepath, 'wb') as f:
                        f.write(base64.b64decode(data))
                    saved_source_image = f"/api/images/{filename}"
                except Exception as e:
                    print(f"保存源图片失败: {e}")
                    saved_source_image = ""
            else:
                # 已经是 URL
                saved_source_image = source_image
        
        video_record = {
            "id": video_id,
            "task_id": task_id,
            "source_image": saved_source_image,
            "prompt": prompt,
            "video_url": video_url,
            "status": status,
            "provider": provider,
            "model": model,
            "duration": duration,
            "seed": seed,
            "created_at": now,
            "updated_at": now
        }
        
        index['videos'].insert(0, video_record)
        index['videos'] = index['videos'][:500]  # 保留最近 500 条
        index['updated_at'] = now
        
        _save_yaml(self._videos_index_file(), index)
        return video_record
    
    def update_video_status(self, task_id: str, status: str, video_url: str = None) -> bool:
        """更新视频任务状态"""
        index = _load_yaml(self._videos_index_file())
        videos = index.get('videos', [])
        
        for video in videos:
            if video.get('task_id') == task_id:
                video['status'] = status
                if video_url:
                    video['video_url'] = video_url
                video['updated_at'] = _now()
                _save_yaml(self._videos_index_file(), index)
                return True
        
        return False
    
    def list_generated_videos(self, limit: int = 50, offset: int = 0) -> List[Dict[str, Any]]:
        """获取视频历史"""
        index = _load_yaml(self._videos_index_file())
        videos = index.get('videos', [])
        return videos[offset:offset + limit]
    
    def delete_generated_video(self, video_id: str) -> bool:
        """删除视频历史记录"""
        index = _load_yaml(self._videos_index_file())
        videos = index.get('videos', [])
        
        original_len = len(videos)
        index['videos'] = [vid for vid in videos if vid.get('id') != video_id]
        
        if len(index['videos']) < original_len:
            index['updated_at'] = _now()
            _save_yaml(self._videos_index_file(), index)
            return True
        return False
    
    def delete_generated_videos_batch(self, video_ids: List[str]) -> int:
        """批量删除视频历史记录"""
        index = _load_yaml(self._videos_index_file())
        videos = index.get('videos', [])
        
        ids_set = set(video_ids)
        original_len = len(videos)
        index['videos'] = [vid for vid in videos if vid.get('id') not in ids_set]
        
        deleted_count = original_len - len(index['videos'])
        if deleted_count > 0:
            index['updated_at'] = _now()
            _save_yaml(self._videos_index_file(), index)
        
        return deleted_count
    
    def get_video_stats(self) -> Dict[str, Any]:
        """获取视频生成统计"""
        index = _load_yaml(self._videos_index_file())
        videos = index.get('videos', [])
        
        providers = {}
        statuses = {}
        for vid in videos:
            p = vid.get('provider', 'unknown')
            s = vid.get('status', 'unknown')
            providers[p] = providers.get(p, 0) + 1
            statuses[s] = statuses.get(s, 0) + 1
        
        return {
            "total": len(videos),
            "by_provider": providers,
            "by_status": statuses
        }
    
    # ==================== 对话历史 ====================
    
    def _chat_file(self, session_id: str) -> str:
        return os.path.join(CHAT_DIR, f"{session_id}.yaml")
    
    def save_chat_message(self, session_id: str, module: str, role: str, content: str) -> Dict[str, Any]:
        """保存对话消息"""
        chat = _load_yaml(self._chat_file(session_id))
        if 'messages' not in chat:
            chat['messages'] = []
            chat['created_at'] = _now()
        
        msg_id = _gen_id()
        now = _now()
        
        message = {
            "id": msg_id,
            "module": module,
            "role": role,
            "content": content,
            "created_at": now
        }
        
        chat['messages'].append(message)
        chat['updated_at'] = now
        chat['session_id'] = session_id
        
        _save_yaml(self._chat_file(session_id), chat)
        return message
    
    def get_chat_history(self, session_id: str, module: str = None, limit: int = 50) -> List[Dict[str, Any]]:
        """获取对话历史"""
        chat = _load_yaml(self._chat_file(session_id))
        messages = chat.get('messages', [])
        
        if module:
            messages = [m for m in messages if m.get('module') == module]
        
        return messages[-limit:]
    
    def list_chat_sessions(self, limit: int = 50) -> List[Dict[str, Any]]:
        """获取所有对话会话列表"""
        sessions = []
        if not os.path.exists(CHAT_DIR):
            return []
        for filename in os.listdir(CHAT_DIR):
            if filename.endswith('.yaml'):
                chat = _load_yaml(os.path.join(CHAT_DIR, filename))
                if chat:
                    sessions.append({
                        "session_id": chat.get("session_id", filename[:-5]),
                        "message_count": len(chat.get("messages", [])),
                        "created_at": chat.get("created_at"),
                        "updated_at": chat.get("updated_at")
                    })
        
        sessions.sort(key=lambda x: x.get('updated_at', ''), reverse=True)
        return sessions[:limit]
    
    def clear_chat_history(self, session_id: str, module: str = None) -> bool:
        """清除对话历史"""
        filepath = self._chat_file(session_id)
        
        if module:
            chat = _load_yaml(filepath)
            chat['messages'] = [m for m in chat.get('messages', []) if m.get('module') != module]
            chat['updated_at'] = _now()
            _save_yaml(filepath, chat)
        else:
            if os.path.exists(filepath):
                os.remove(filepath)
        
        return True
    
    # ==================== 数据导出/导入 ====================
    
    def export_all(self, include_images: bool = True) -> str:
        """导出所有数据为 ZIP 文件"""
        now = datetime.now().strftime("%Y%m%d_%H%M%S")
        export_name = f"storyboarder_backup_{now}"
        export_path = os.path.join(EXPORT_DIR, f"{export_name}.zip")
        
        with zipfile.ZipFile(export_path, 'w', zipfile.ZIP_DEFLATED) as zf:
            # 导出项目
            for filename in os.listdir(PROJECTS_DIR):
                if filename.endswith('.yaml'):
                    zf.write(os.path.join(PROJECTS_DIR, filename), f"projects/{filename}")
            
            # 导出剧本
            for filename in os.listdir(SCRIPTS_DIR):
                if filename.endswith('.yaml'):
                    zf.write(os.path.join(SCRIPTS_DIR, filename), f"scripts/{filename}")
            
            # 导出对话
            for filename in os.listdir(CHAT_DIR):
                if filename.endswith('.yaml'):
                    zf.write(os.path.join(CHAT_DIR, filename), f"chat/{filename}")
            
            # 导出图像索引
            if include_images:
                images_index = self._images_index_file()
                if os.path.exists(images_index):
                    zf.write(images_index, "images/index.yaml")
            
            # 导出元数据
            meta = {
                "export_time": _now(),
                "version": "1.0",
                "projects_count": len(os.listdir(PROJECTS_DIR)),
                "scripts_count": len(os.listdir(SCRIPTS_DIR)),
                "chat_sessions_count": len(os.listdir(CHAT_DIR))
            }
            zf.writestr("meta.yaml", yaml.dump(meta, allow_unicode=True))
        
        return export_path
    
    def export_project(self, project_id: str) -> Optional[str]:
        """导出单个项目"""
        project = self.get_project(project_id)
        if not project:
            return None
        
        now = datetime.now().strftime("%Y%m%d_%H%M%S")
        export_name = f"project_{project_id}_{now}"
        export_path = os.path.join(EXPORT_DIR, f"{export_name}.yaml")
        
        _save_yaml(export_path, project)
        return export_path
    
    def import_data(self, zip_path: str, merge: bool = True) -> Dict[str, Any]:
        """从 ZIP 文件导入数据"""
        if not os.path.exists(zip_path):
            return {"success": False, "error": "文件不存在"}
        
        stats = {"projects": 0, "scripts": 0, "chat": 0, "skipped": 0}
        
        with zipfile.ZipFile(zip_path, 'r') as zf:
            for name in zf.namelist():
                if name.startswith('projects/') and name.endswith('.yaml'):
                    data = yaml.safe_load(zf.read(name))
                    if data and 'id' in data:
                        target = self._project_file(data['id'])
                        if merge or not os.path.exists(target):
                            _save_yaml(target, data)
                            stats['projects'] += 1
                        else:
                            stats['skipped'] += 1
                
                elif name.startswith('scripts/') and name.endswith('.yaml'):
                    data = yaml.safe_load(zf.read(name))
                    if data and 'id' in data:
                        target = self._script_file(data['id'])
                        if merge or not os.path.exists(target):
                            _save_yaml(target, data)
                            stats['scripts'] += 1
                        else:
                            stats['skipped'] += 1
                
                elif name.startswith('chat/') and name.endswith('.yaml'):
                    data = yaml.safe_load(zf.read(name))
                    if data:
                        session_id = data.get('session_id', name.split('/')[-1][:-5])
                        target = self._chat_file(session_id)
                        if merge or not os.path.exists(target):
                            _save_yaml(target, data)
                            stats['chat'] += 1
                        else:
                            stats['skipped'] += 1
                
                elif name == 'images/index.yaml':
                    data = yaml.safe_load(zf.read(name))
                    if data and merge:
                        existing = _load_yaml(self._images_index_file())
                        existing_ids = {img.get('id') for img in existing.get('images', [])}
                        for img in data.get('images', []):
                            if img.get('id') not in existing_ids:
                                if 'images' not in existing:
                                    existing['images'] = []
                                existing['images'].append(img)
                        existing['images'].sort(key=lambda x: x.get('created_at', ''), reverse=True)
                        _save_yaml(self._images_index_file(), existing)
        
        return {"success": True, "stats": stats}
    
    def import_project(self, yaml_path: str) -> Optional[Dict[str, Any]]:
        """导入单个项目"""
        if not os.path.exists(yaml_path):
            return None
        
        project = _load_yaml(yaml_path)
        if not project or 'id' not in project:
            return None
        
        # 生成新 ID 避免冲突
        old_id = project['id']
        project['id'] = _gen_id()
        project['imported_from'] = old_id
        project['imported_at'] = _now()
        
        _save_yaml(self._project_file(project['id']), project)
        return project
    
    def list_exports(self) -> List[Dict[str, Any]]:
        """列出所有导出文件"""
        exports = []
        if not os.path.exists(EXPORT_DIR):
            return []
        for filename in os.listdir(EXPORT_DIR):
            filepath = os.path.join(EXPORT_DIR, filename)
            if os.path.isfile(filepath):
                exports.append({
                    "filename": filename,
                    "path": filepath,
                    "size": os.path.getsize(filepath),
                    "created_at": datetime.fromtimestamp(os.path.getctime(filepath)).isoformat()
                })
        
        exports.sort(key=lambda x: x.get('created_at', ''), reverse=True)
        return exports
    
    # ==================== 数据统计 ====================
    
    def get_stats(self) -> Dict[str, Any]:
        """获取整体数据统计"""
        projects_count = len([f for f in os.listdir(PROJECTS_DIR) if f.endswith('.yaml')]) if os.path.exists(PROJECTS_DIR) else 0
        scripts_count = len([f for f in os.listdir(SCRIPTS_DIR) if f.endswith('.yaml')]) if os.path.exists(SCRIPTS_DIR) else 0
        chat_count = len([f for f in os.listdir(CHAT_DIR) if f.endswith('.yaml')]) if os.path.exists(CHAT_DIR) else 0
        
        images_index = _load_yaml(self._images_index_file())
        images_count = len(images_index.get('images', []))
        
        return {
            "projects": projects_count,
            "scripts": scripts_count,
            "chat_sessions": chat_count,
            "generated_images": images_count,
            "data_dir": DATA_DIR
        }


# 全局实例
storage = StorageService()
print(f"[Storage] YAML 文件存储服务已初始化，数据目录: {DATA_DIR}")
