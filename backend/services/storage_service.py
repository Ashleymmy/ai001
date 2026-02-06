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
SETTINGS_TEMPLATE_FILE = os.path.join(DATA_DIR, "settings.yaml")
SETTINGS_LOCAL_FILE = os.path.join(DATA_DIR, "settings.local.yaml")
MODULE_SETTINGS_TEMPLATE_FILE = os.path.join(DATA_DIR, "module.settings.yaml")
MODULE_SETTINGS_LOCAL_FILE = os.path.join(DATA_DIR, "module.settings.local.yaml")
CUSTOM_PROVIDERS_TEMPLATE_FILE = os.path.join(DATA_DIR, "custom_providers.yaml")
CUSTOM_PROVIDERS_LOCAL_FILE = os.path.join(DATA_DIR, "custom_providers.local.yaml")
MODULE_CUSTOM_PROVIDERS_TEMPLATE_FILE = os.path.join(DATA_DIR, "module.custom_providers.yaml")
MODULE_CUSTOM_PROVIDERS_LOCAL_FILE = os.path.join(DATA_DIR, "module.custom_providers.local.yaml")
PROMPTS_TEMPLATE_FILE = os.path.join(DATA_DIR, "prompts.yaml")
PROMPTS_LOCAL_FILE = os.path.join(DATA_DIR, "prompts.local.yaml")

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
        _save_yaml(SETTINGS_LOCAL_FILE, settings)
        return settings
    
    def get_settings(self) -> Optional[Dict[str, Any]]:
        """获取设置"""
        if os.path.exists(SETTINGS_LOCAL_FILE):
            return _load_yaml(SETTINGS_LOCAL_FILE)
        if os.path.exists(SETTINGS_TEMPLATE_FILE):
            return _load_yaml(SETTINGS_TEMPLATE_FILE)
        return None

    def save_module_settings(self, settings: Dict[str, Any]) -> Dict[str, Any]:
        """保存独立模块设置（与 Agent 设置隔离）"""
        settings['updated_at'] = _now()
        _save_yaml(MODULE_SETTINGS_LOCAL_FILE, settings)
        return settings

    def get_module_settings(self) -> Optional[Dict[str, Any]]:
        """获取独立模块设置（优先 local，其次 template）"""
        if os.path.exists(MODULE_SETTINGS_LOCAL_FILE):
            return _load_yaml(MODULE_SETTINGS_LOCAL_FILE)
        if os.path.exists(MODULE_SETTINGS_TEMPLATE_FILE):
            return _load_yaml(MODULE_SETTINGS_TEMPLATE_FILE)
        return None

    # ==================== Prompt 配置管理 ====================

    def _prompts_file(self) -> str:
        if os.path.exists(PROMPTS_LOCAL_FILE):
            return PROMPTS_LOCAL_FILE
        return PROMPTS_TEMPLATE_FILE

    def get_prompts(self) -> Dict[str, Any]:
        """获取提示词配置（system prompt / templates）。"""
        return _load_yaml(self._prompts_file())
    
    # ==================== 自定义配置预设管理 ====================
    
    def _custom_providers_file(self) -> str:
        if os.path.exists(CUSTOM_PROVIDERS_LOCAL_FILE):
            return CUSTOM_PROVIDERS_LOCAL_FILE
        return CUSTOM_PROVIDERS_TEMPLATE_FILE

    def _module_custom_providers_file(self) -> str:
        if os.path.exists(MODULE_CUSTOM_PROVIDERS_LOCAL_FILE):
            return MODULE_CUSTOM_PROVIDERS_LOCAL_FILE
        return MODULE_CUSTOM_PROVIDERS_TEMPLATE_FILE

    def _list_custom_providers_by_file(self, filepath: str, category: str = None) -> List[Dict[str, Any]]:
        data = _load_yaml(filepath)
        providers = data.get('providers', [])
        if category:
            providers = [p for p in providers if p.get('category') == category]
        return providers

    def _add_custom_provider_by_file(self, filepath: str, name: str, category: str, config: Dict[str, Any]) -> Dict[str, Any]:
        data = _load_yaml(filepath)
        if 'providers' not in data:
            data['providers'] = []

        provider_id = f"custom_{_gen_id()}"
        now = _now()

        provider = {
            "id": provider_id,
            "name": name,
            "category": category,
            "isCustom": True,
            "apiKey": config.get('apiKey', ''),
            "baseUrl": config.get('baseUrl', ''),
            "model": config.get('model', ''),
            "models": config.get('models', []),
            "created_at": now,
            "updated_at": now
        }

        data['providers'].append(provider)
        data['updated_at'] = now
        _save_yaml(filepath, data)
        return provider

    def _get_custom_provider_by_file(self, filepath: str, provider_id: str) -> Optional[Dict[str, Any]]:
        data = _load_yaml(filepath)
        for p in data.get('providers', []):
            if p.get('id') == provider_id:
                return p
        return None

    def _update_custom_provider_by_file(self, filepath: str, provider_id: str, updates: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        data = _load_yaml(filepath)
        for p in data.get('providers', []):
            if p.get('id') == provider_id:
                allowed_fields = ['name', 'apiKey', 'baseUrl', 'model', 'models']
                for key, value in updates.items():
                    if key in allowed_fields:
                        p[key] = value
                p['updated_at'] = _now()
                data['updated_at'] = _now()
                _save_yaml(filepath, data)
                return p
        return None

    def _delete_custom_provider_by_file(self, filepath: str, provider_id: str) -> bool:
        data = _load_yaml(filepath)
        providers = data.get('providers', [])
        original_len = len(providers)
        data['providers'] = [p for p in providers if p.get('id') != provider_id]
        if len(data['providers']) < original_len:
            data['updated_at'] = _now()
            _save_yaml(filepath, data)
            return True
        return False

    def list_custom_providers(self, category: str = None) -> List[Dict[str, Any]]:
        """获取全局自定义配置列表（Agent 侧）。"""
        return self._list_custom_providers_by_file(self._custom_providers_file(), category)

    def add_custom_provider(self, name: str, category: str, config: Dict[str, Any]) -> Dict[str, Any]:
        """添加全局自定义配置预设（Agent 侧）。"""
        return self._add_custom_provider_by_file(self._custom_providers_file(), name, category, config)

    def get_custom_provider(self, provider_id: str) -> Optional[Dict[str, Any]]:
        """获取单个全局自定义配置（Agent 侧）。"""
        return self._get_custom_provider_by_file(self._custom_providers_file(), provider_id)

    def update_custom_provider(self, provider_id: str, updates: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """更新全局自定义配置预设（Agent 侧）。"""
        return self._update_custom_provider_by_file(self._custom_providers_file(), provider_id, updates)

    def delete_custom_provider(self, provider_id: str) -> bool:
        """删除全局自定义配置预设（Agent 侧）。"""
        return self._delete_custom_provider_by_file(self._custom_providers_file(), provider_id)

    def list_module_custom_providers(self, category: str = None) -> List[Dict[str, Any]]:
        """获取独立模块自定义配置列表（合并模块侧与全局侧，模块侧优先）。"""
        module_list = self._list_custom_providers_by_file(self._module_custom_providers_file(), category)
        global_list = self._list_custom_providers_by_file(self._custom_providers_file(), category)
        merged: Dict[str, Dict[str, Any]] = {}
        for provider in global_list:
            pid = provider.get("id")
            if isinstance(pid, str) and pid:
                merged[pid] = provider
        for provider in module_list:
            pid = provider.get("id")
            if isinstance(pid, str) and pid:
                merged[pid] = provider
        return list(merged.values())

    def add_module_custom_provider(self, name: str, category: str, config: Dict[str, Any]) -> Dict[str, Any]:
        """添加独立模块自定义配置预设。"""
        return self._add_custom_provider_by_file(self._module_custom_providers_file(), name, category, config)

    def get_module_custom_provider(self, provider_id: str) -> Optional[Dict[str, Any]]:
        """获取单个独立模块自定义配置。"""
        return self._get_custom_provider_by_file(self._module_custom_providers_file(), provider_id)

    def update_module_custom_provider(self, provider_id: str, updates: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """更新独立模块自定义配置预设。"""
        return self._update_custom_provider_by_file(self._module_custom_providers_file(), provider_id, updates)

    def delete_module_custom_provider(self, provider_id: str) -> bool:
        """删除独立模块自定义配置预设。"""
        return self._delete_custom_provider_by_file(self._module_custom_providers_file(), provider_id)
    
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
                             seed: int = 0, style: str = None, project_id: Optional[str] = None) -> Dict[str, Any]:
        """保存生成的图像记录"""
        index = _load_yaml(self._images_index_file())
        if 'images' not in index:
            index['images'] = []
        
        image_id = _gen_id()
        now = _now()
        
        image_record = {
            "id": image_id,
            "project_id": project_id,
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
    
    def list_generated_images(self, limit: int = 100, offset: int = 0, project_id: Optional[str] = None) -> List[Dict[str, Any]]:
        """获取图像历史"""
        index = _load_yaml(self._images_index_file())
        images = index.get('images', [])
        if project_id is not None:
            images = [img for img in images if img.get('project_id') == project_id]
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
                             seed: int = 0, project_id: Optional[str] = None) -> Dict[str, Any]:
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
            "project_id": project_id,
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
    
    def list_generated_videos(self, limit: int = 50, offset: int = 0, project_id: Optional[str] = None) -> List[Dict[str, Any]]:
        """获取视频历史"""
        index = _load_yaml(self._videos_index_file())
        videos = index.get('videos', [])
        if project_id is not None:
            videos = [vid for vid in videos if vid.get('project_id') == project_id]
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
    
    def list_chat_sessions(self, limit: int = 50, module: Optional[str] = None) -> List[Dict[str, Any]]:
        """获取对话会话列表（可按模块过滤）"""
        sessions = []
        if not os.path.exists(CHAT_DIR):
            return []
        for filename in os.listdir(CHAT_DIR):
            if filename.endswith('.yaml'):
                chat = _load_yaml(os.path.join(CHAT_DIR, filename))
                if chat:
                    messages = chat.get("messages", [])
                    session_updated_at = chat.get("updated_at")
                    message_count = len(messages)
                    if module:
                        module_messages = [m for m in messages if m.get("module") == module]
                        if not module_messages:
                            continue
                        message_count = len(module_messages)
                        # 模块维度下按最后一条该模块消息时间排序更符合预期
                        session_updated_at = module_messages[-1].get("created_at") or session_updated_at
                    sessions.append({
                        "session_id": chat.get("session_id", filename[:-5]),
                        "message_count": message_count,
                        "created_at": chat.get("created_at"),
                        "updated_at": session_updated_at
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
    
    # ==================== Agent 项目管理 ====================
    
    def _agent_projects_dir(self) -> str:
        """Agent 项目目录"""
        agent_dir = os.path.join(DATA_DIR, "agent_projects")
        os.makedirs(agent_dir, exist_ok=True)
        return agent_dir
    
    def _agent_project_file(self, project_id: str) -> str:
        return os.path.join(self._agent_projects_dir(), f"{project_id}.yaml")
    
    def save_agent_project(self, project_data: Dict[str, Any]) -> Dict[str, Any]:
        """保存 Agent 项目"""
        project_id = project_data.get('id')
        if not project_id:
            project_id = f"agent_{_gen_id()}"
            project_data['id'] = project_id
        
        project_data['updated_at'] = _now()
        _save_yaml(self._agent_project_file(project_id), project_data)
        return project_data
    
    def get_agent_project(self, project_id: str) -> Optional[Dict[str, Any]]:
        """获取 Agent 项目"""
        filepath = self._agent_project_file(project_id)
        if not os.path.exists(filepath):
            return None
        return _load_yaml(filepath)
    
    def list_agent_projects(self, limit: int = 50) -> List[Dict[str, Any]]:
        """获取 Agent 项目列表"""
        projects = []
        agent_dir = self._agent_projects_dir()
        
        if not os.path.exists(agent_dir):
            return []
        
        for filename in os.listdir(agent_dir):
            if filename.endswith('.yaml'):
                project = _load_yaml(os.path.join(agent_dir, filename))
                if project:
                    # 返回简要信息
                    projects.append({
                        "id": project.get("id"),
                        "name": project.get("name"),
                        "creative_brief": project.get("creative_brief", {}),
                        "elements_count": len(project.get("elements", {})),
                        "segments_count": len(project.get("segments", [])),
                        "created_at": project.get("created_at"),
                        "updated_at": project.get("updated_at")
                    })
        
        projects.sort(key=lambda x: x.get('updated_at', ''), reverse=True)
        return projects[:limit]

    def _iter_agent_projects_full(self) -> List[Dict[str, Any]]:
        """遍历完整 Agent 项目数据（按更新时间倒序）。"""
        projects: List[Dict[str, Any]] = []
        agent_dir = self._agent_projects_dir()
        if not os.path.exists(agent_dir):
            return projects
        for filename in os.listdir(agent_dir):
            if not filename.endswith('.yaml'):
                continue
            project = _load_yaml(os.path.join(agent_dir, filename))
            if isinstance(project, dict) and project:
                projects.append(project)
        projects.sort(key=lambda x: x.get('updated_at', ''), reverse=True)
        return projects

    def list_agent_generated_images(self, limit: int = 100, project_id: Optional[str] = None) -> List[Dict[str, Any]]:
        """汇总 Agent 生成图片历史（元素图 + 起始帧）。"""
        records: List[Dict[str, Any]] = []
        seen_ids = set()

        def _pick_url(primary: Any, cached: Any = None) -> str:
            for candidate in (cached, primary):
                if isinstance(candidate, str) and candidate.strip():
                    return candidate.strip()
            return ""

        def _append_record(record: Dict[str, Any]):
            rid = record.get("id")
            if isinstance(rid, str) and rid in seen_ids:
                return
            if isinstance(rid, str):
                seen_ids.add(rid)
            records.append(record)

        for project in self._iter_agent_projects_full():
            pid = str(project.get("id") or "")
            if project_id and pid != project_id:
                continue

            project_name = str(project.get("name") or pid)
            project_updated = project.get("updated_at") or project.get("created_at") or _now()

            elements = project.get("elements") or {}
            if isinstance(elements, dict):
                for element_id, element in elements.items():
                    if not isinstance(element, dict):
                        continue
                    eid = str(element_id or element.get("id") or "")
                    title = str(element.get("name") or eid or "element")
                    prompt_text = str(element.get("description") or element.get("name") or "").strip()
                    created_fallback = element.get("updated_at") or element.get("created_at") or project_updated
                    history = element.get("image_history") or []

                    if isinstance(history, list) and history:
                        for idx, img in enumerate(history):
                            if not isinstance(img, dict):
                                continue
                            image_id = str(img.get("id") or f"{eid}_{idx}")
                            image_url = _pick_url(img.get("source_url"), img.get("url"))
                            if not image_url:
                                continue
                            created_at = img.get("created_at") or created_fallback
                            _append_record({
                                "id": f"agent_elem_{pid}_{eid}_{image_id}",
                                "project_id": pid,
                                "project_name": project_name,
                                "source": "agent",
                                "source_type": "element",
                                "source_id": eid,
                                "title": title,
                                "prompt": prompt_text,
                                "negative_prompt": "",
                                "image_url": image_url,
                                "provider": "agent",
                                "model": "",
                                "width": None,
                                "height": None,
                                "steps": None,
                                "seed": None,
                                "style": None,
                                "created_at": created_at,
                            })
                    else:
                        image_url = _pick_url(element.get("image_url"), element.get("cached_image_url"))
                        if image_url:
                            _append_record({
                                "id": f"agent_elem_{pid}_{eid}_current",
                                "project_id": pid,
                                "project_name": project_name,
                                "source": "agent",
                                "source_type": "element",
                                "source_id": eid,
                                "title": title,
                                "prompt": prompt_text,
                                "negative_prompt": "",
                                "image_url": image_url,
                                "provider": "agent",
                                "model": "",
                                "width": None,
                                "height": None,
                                "steps": None,
                                "seed": None,
                                "style": None,
                                "created_at": created_fallback,
                            })

            segments = project.get("segments") or []
            if isinstance(segments, list):
                for seg in segments:
                    if not isinstance(seg, dict):
                        continue
                    for shot in (seg.get("shots") or []):
                        if not isinstance(shot, dict):
                            continue
                        sid = str(shot.get("id") or "")
                        title = str(shot.get("name") or sid or "shot")
                        prompt_text = str(shot.get("prompt") or shot.get("description") or "").strip()
                        created_fallback = shot.get("updated_at") or shot.get("created_at") or project_updated
                        history = shot.get("start_image_history") or []

                        if isinstance(history, list) and history:
                            for idx, img in enumerate(history):
                                if not isinstance(img, dict):
                                    continue
                                image_id = str(img.get("id") or f"{sid}_{idx}")
                                image_url = _pick_url(img.get("source_url"), img.get("url"))
                                if not image_url:
                                    continue
                                created_at = img.get("created_at") or created_fallback
                                _append_record({
                                    "id": f"agent_shot_{pid}_{sid}_{image_id}",
                                    "project_id": pid,
                                    "project_name": project_name,
                                    "source": "agent",
                                    "source_type": "shot",
                                    "source_id": sid,
                                    "title": title,
                                    "prompt": prompt_text,
                                    "negative_prompt": "",
                                    "image_url": image_url,
                                    "provider": "agent",
                                    "model": "",
                                    "width": None,
                                    "height": None,
                                    "steps": None,
                                    "seed": None,
                                    "style": None,
                                    "created_at": created_at,
                                })
                        else:
                            image_url = _pick_url(shot.get("start_image_url"), shot.get("cached_start_image_url"))
                            if image_url:
                                _append_record({
                                    "id": f"agent_shot_{pid}_{sid}_current",
                                    "project_id": pid,
                                    "project_name": project_name,
                                    "source": "agent",
                                    "source_type": "shot",
                                    "source_id": sid,
                                    "title": title,
                                    "prompt": prompt_text,
                                    "negative_prompt": "",
                                    "image_url": image_url,
                                    "provider": "agent",
                                    "model": "",
                                    "width": None,
                                    "height": None,
                                    "steps": None,
                                    "seed": None,
                                    "style": None,
                                    "created_at": created_fallback,
                                })

        records.sort(key=lambda x: x.get("created_at", ""), reverse=True)
        return records[:limit]

    def list_agent_generated_videos(self, limit: int = 50, project_id: Optional[str] = None) -> List[Dict[str, Any]]:
        """汇总 Agent 生成视频历史（从镜头中提取）。"""
        records: List[Dict[str, Any]] = []
        for project in self._iter_agent_projects_full():
            pid = str(project.get("id") or "")
            if project_id and pid != project_id:
                continue

            project_name = str(project.get("name") or pid)
            project_updated = project.get("updated_at") or project.get("created_at") or _now()
            segments = project.get("segments") or []
            if not isinstance(segments, list):
                continue

            for seg in segments:
                if not isinstance(seg, dict):
                    continue
                for shot in (seg.get("shots") or []):
                    if not isinstance(shot, dict):
                        continue
                    video_url = shot.get("video_url")
                    if not isinstance(video_url, str) or not video_url.strip():
                        continue

                    sid = str(shot.get("id") or "")
                    created_at = shot.get("updated_at") or shot.get("created_at") or project_updated
                    status_raw = str(shot.get("status") or "").lower()
                    status = "completed" if status_raw in {"video_ready", "completed", "done"} else (
                        "processing" if "processing" in status_raw else "completed"
                    )

                    records.append({
                        "id": f"agent_video_{pid}_{sid}",
                        "project_id": pid,
                        "project_name": project_name,
                        "source": "agent",
                        "task_id": shot.get("video_task_id") or "",
                        "source_image": shot.get("cached_start_image_url") or shot.get("start_image_url") or "",
                        "prompt": shot.get("video_prompt") or shot.get("prompt") or shot.get("description") or "",
                        "video_url": video_url.strip(),
                        "status": status,
                        "provider": "agent",
                        "model": "",
                        "duration": shot.get("duration") or 5,
                        "seed": shot.get("seed") or 0,
                        "created_at": created_at,
                        "updated_at": created_at,
                    })

        records.sort(key=lambda x: x.get("updated_at", ""), reverse=True)
        return records[:limit]
    
    def update_agent_project(self, project_id: str, updates: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """更新 Agent 项目"""
        print(f"[Storage] 更新 Agent 项目: {project_id}")
        project = self.get_agent_project(project_id)
        if not project:
            print(f"[Storage] 项目不存在: {project_id}")
            return None
        
        # 更新字段
        for key, value in updates.items():
            project[key] = value
            print(f"[Storage] 更新字段: {key} = {type(value).__name__}")
        
        project['updated_at'] = _now()
        filepath = self._agent_project_file(project_id)
        print(f"[Storage] 保存到文件: {filepath}")
        _save_yaml(filepath, project)
        print(f"[Storage] 项目已保存")
        return project
    
    def delete_agent_project(self, project_id: str) -> bool:
        """删除 Agent 项目"""
        filepath = self._agent_project_file(project_id)
        if os.path.exists(filepath):
            os.remove(filepath)
            return True
        return False
    
    def get_custom_providers(self) -> Dict[str, Dict[str, Any]]:
        """获取自定义配置字典（按 ID 索引）"""
        data = _load_yaml(self._custom_providers_file())
        providers = data.get('providers', [])
        return {p.get('id'): p for p in providers if p.get('id')}

    def get_module_custom_providers(self) -> Dict[str, Dict[str, Any]]:
        """获取独立模块自定义配置字典（按 ID 索引）。"""
        data = _load_yaml(self._module_custom_providers_file())
        providers = data.get('providers', [])
        return {p.get('id'): p for p in providers if p.get('id')}


# 全局实例
storage = StorageService()
print(f"[Storage] YAML 文件存储服务已初始化，数据目录: {DATA_DIR}")
