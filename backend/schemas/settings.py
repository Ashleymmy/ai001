"""Pydantic models extracted from main.py."""

from __future__ import annotations

import re
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field, model_validator


# ---------------------------------------------------------------------------
# Settings / Config models
# ---------------------------------------------------------------------------

class ModelConfig(BaseModel):
    provider: str
    apiKey: str = ""
    baseUrl: str = ""
    model: str = ""
    customProvider: Optional[str] = None


class LocalConfig(BaseModel):
    enabled: bool = False
    comfyuiUrl: str = "http://127.0.0.1:8188"
    sdWebuiUrl: str = "http://127.0.0.1:7860"
    vramStrategy: str = "auto"


class VolcTTSSettings(BaseModel):
    appid: str = ""
    accessToken: str = ""
    endpoint: str = "https://openspeech.bytedance.com/api/v1/tts"
    cluster: str = "volcano_tts"
    model: str = "seed-tts-1.1"
    encoding: str = "mp3"
    rate: int = 24000
    speedRatio: float = 1.0
    narratorVoiceType: str = ""
    dialogueVoiceType: str = ""
    dialogueMaleVoiceType: str = ""
    dialogueFemaleVoiceType: str = ""


class FishTTSSettings(BaseModel):
    apiKey: str = ""
    baseUrl: str = "https://api.fish.audio"
    model: str = "speech-1.5"
    encoding: str = "mp3"
    rate: int = 24000
    speedRatio: float = 1.0
    narratorVoiceType: str = ""
    dialogueVoiceType: str = ""
    dialogueMaleVoiceType: str = ""
    dialogueFemaleVoiceType: str = ""


class BailianTTSSettings(BaseModel):
    apiKey: str = ""
    baseUrl: str = "wss://dashscope.aliyuncs.com/api-ws/v1/inference"
    workspace: str = ""
    model: str = "cosyvoice-v1"
    encoding: str = "mp3"
    rate: int = 24000
    speedRatio: float = 1.0
    narratorVoiceType: str = ""
    dialogueVoiceType: str = ""
    dialogueMaleVoiceType: str = ""
    dialogueFemaleVoiceType: str = ""


class CustomTTSDefaults(BaseModel):
    encoding: str = "mp3"
    rate: int = 24000
    speedRatio: float = 1.0
    narratorVoiceType: str = ""
    dialogueVoiceType: str = ""
    dialogueMaleVoiceType: str = ""
    dialogueFemaleVoiceType: str = ""


class TTSConfig(BaseModel):
    provider: str = "volc_tts_v1_http"
    volc: VolcTTSSettings = Field(default_factory=VolcTTSSettings)
    fish: FishTTSSettings = Field(default_factory=FishTTSSettings)
    bailian: BailianTTSSettings = Field(default_factory=BailianTTSSettings)
    custom: CustomTTSDefaults = Field(default_factory=CustomTTSDefaults)

    # legacy flat fields (for backwards compatibility)
    appid: Optional[str] = None
    accessToken: Optional[str] = None
    baseUrl: Optional[str] = None
    cluster: Optional[str] = None
    model: Optional[str] = None
    encoding: Optional[str] = None
    rate: Optional[int] = None
    speedRatio: Optional[float] = None
    narratorVoiceType: Optional[str] = None
    dialogueVoiceType: Optional[str] = None
    dialogueMaleVoiceType: Optional[str] = None
    dialogueFemaleVoiceType: Optional[str] = None

    @model_validator(mode="before")
    @classmethod
    def _migrate_legacy_payload(cls, data: Any):
        if not isinstance(data, dict):
            return data

        if any(k in data for k in ("volc", "fish", "bailian", "custom")):
            fish = data.get("fish")
            if isinstance(fish, dict) and "accessToken" in fish and "apiKey" not in fish:
                fish = {**fish, "apiKey": fish.get("accessToken") or ""}
                data = {**data, "fish": fish}
            bailian = data.get("bailian")
            if isinstance(bailian, dict):
                raw = str(bailian.get("baseUrl") or bailian.get("base_url") or "").strip()
                if raw and raw.startswith(("http://", "https://")) and "dashscope.aliyuncs.com" in raw:
                    bailian = {**bailian, "baseUrl": "wss://dashscope.aliyuncs.com/api-ws/v1/inference"}
                    data = {**data, "bailian": bailian}
            return data

        provider = str(data.get("provider") or "volc_tts_v1_http").strip() or "volc_tts_v1_http"
        raw_base_url = str(data.get("baseUrl") or data.get("base_url") or "").strip()

        def looks_like_fish_voice_id(value: str) -> bool:
            v = (value or "").strip().lower()
            if not v:
                return False
            if re.fullmatch(r"[0-9a-f]{32}", v):
                return True
            if re.fullmatch(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", v):
                return True
            return False

        def looks_like_volc_voice_type(value: str) -> bool:
            v = (value or "").strip().lower()
            return bool(v) and (v.startswith("zh_") or v.startswith("en_"))

        legacy_voice = {
            "narratorVoiceType": str(data.get("narratorVoiceType") or "").strip(),
            "dialogueVoiceType": str(data.get("dialogueVoiceType") or "").strip(),
            "dialogueMaleVoiceType": str(data.get("dialogueMaleVoiceType") or "").strip(),
            "dialogueFemaleVoiceType": str(data.get("dialogueFemaleVoiceType") or "").strip(),
        }

        volc_voice: Dict[str, str] = {}
        fish_voice: Dict[str, str] = {}
        for k, v in legacy_voice.items():
            if looks_like_fish_voice_id(v):
                fish_voice[k] = v
            elif looks_like_volc_voice_type(v):
                volc_voice[k] = v
            else:
                (fish_voice if provider.startswith("fish") else volc_voice)[k] = v

        legacy_access_token = str(data.get("accessToken") or data.get("access_token") or "").strip()
        volc_token = legacy_access_token if not provider.startswith("fish") else ""
        fish_key = legacy_access_token if provider.startswith("fish") else ""

        volc_endpoint = ""
        fish_base_url = ""
        if raw_base_url:
            if "fish.audio" in raw_base_url:
                fish_base_url = raw_base_url
            elif "openspeech.bytedance.com" in raw_base_url or raw_base_url.endswith("/tts"):
                volc_endpoint = raw_base_url
            else:
                fish_base_url = raw_base_url

        volc = {
            "appid": str(data.get("appid") or "").strip(),
            "accessToken": volc_token,
            "endpoint": volc_endpoint or "https://openspeech.bytedance.com/api/v1/tts",
            "cluster": str(data.get("cluster") or "volcano_tts").strip() or "volcano_tts",
            "model": str(data.get("model") or "seed-tts-1.1").strip() or "seed-tts-1.1",
            "encoding": str(data.get("encoding") or "mp3").strip() or "mp3",
            "rate": int(data.get("rate") or 24000),
            "speedRatio": float(data.get("speedRatio") or 1.0),
            **volc_voice,
        }

        fish_model = str(data.get("model") or "").strip()
        if not fish_model or fish_model.startswith("seed-"):
            fish_model = "speech-1.5"

        fish = {
            "apiKey": fish_key,
            "baseUrl": fish_base_url or "https://api.fish.audio",
            "model": fish_model,
            "encoding": str(data.get("encoding") or "mp3").strip() or "mp3",
            "rate": int(data.get("rate") or 24000),
            "speedRatio": float(data.get("speedRatio") or 1.0),
            **fish_voice,
        }

        return {
            "provider": provider,
            "volc": volc,
            "fish": fish,
            "bailian": BailianTTSSettings().model_dump(),
            "custom": CustomTTSDefaults().model_dump(),
        }


class SettingsRequest(BaseModel):
    llm: ModelConfig
    image: ModelConfig
    storyboard: Optional[ModelConfig] = None
    video: ModelConfig
    local: LocalConfig
    tts: Optional[TTSConfig] = None


class TestConnectionRequest(BaseModel):
    category: str  # llm/image/storyboard/video
    config: ModelConfig
    local: Optional[LocalConfig] = None


# ---------------------------------------------------------------------------
# Generation models
# ---------------------------------------------------------------------------

class GenerateRequest(BaseModel):
    referenceImage: Optional[str] = None
    storyText: str
    style: str = "cinematic"
    count: int = 4
    llm: Optional[ModelConfig] = None
    storyboard: Optional[ModelConfig] = None
    local: Optional[LocalConfig] = None


class ParseStoryRequest(BaseModel):
    storyText: str
    style: str = "cinematic"
    count: int = 4
    llm: Optional[ModelConfig] = None


class RegenerateRequest(BaseModel):
    prompt: str
    referenceImage: Optional[str] = None
    style: str = "cinematic"
    storyboard: Optional[ModelConfig] = None
    local: Optional[LocalConfig] = None


class ChatRequest(BaseModel):
    message: str
    context: Optional[str] = None
    llm: Optional[ModelConfig] = None


class BridgeGenerateTextRequest(BaseModel):
    prompt: str
    systemPrompt: Optional[str] = ""
    temperature: float = 0.7
    maxTokens: Optional[int] = None
    model: Optional[str] = None
    topP: Optional[float] = None


class VideoRequest(BaseModel):
    imageUrl: str
    projectId: Optional[str] = None
    scope: str = "module"  # module | agent
    prompt: str = ""
    duration: float = 5.0
    motionStrength: float = 0.5
    seed: Optional[int] = None
    resolution: str = "720p"
    ratio: str = "16:9"
    cameraFixed: bool = False
    watermark: bool = False
    generateAudio: bool = True
    referenceMode: Optional[str] = None
    firstFrameUrl: Optional[str] = None
    lastFrameUrl: Optional[str] = None
    referenceImageUrls: Optional[List[str]] = None
    video: Optional[ModelConfig] = None


class VideoTaskStatusRequest(BaseModel):
    taskId: str


# ---------------------------------------------------------------------------
# Agent models
# ---------------------------------------------------------------------------

class GenerateAgentAudioRequest(BaseModel):
    overwrite: bool = False
    includeNarration: bool = True
    includeDialogue: bool = True
    shotIds: Optional[List[str]] = None
    narratorVoiceType: Optional[str] = None
    dialogueVoiceType: Optional[str] = None
    dialogueMaleVoiceType: Optional[str] = None
    dialogueFemaleVoiceType: Optional[str] = None
    speedRatio: Optional[float] = None
    rate: Optional[int] = None
    encoding: Optional[str] = None


class ClearAgentAudioRequest(BaseModel):
    shotIds: Optional[List[str]] = None
    deleteFiles: bool = True


class TestTTSRequest(BaseModel):
    tts: TTSConfig
    voiceType: Optional[str] = None
    text: Optional[str] = None


class SaveAudioTimelineRequest(BaseModel):
    audioTimeline: Dict[str, Any]
    applyToProject: bool = False
    resetVideos: bool = False


class AudioTimelineMasterAudioRequest(BaseModel):
    shotDurations: Optional[Dict[str, float]] = None
    modes: Optional[List[str]] = None


class ExtractVideoAudioRequest(BaseModel):
    shotIds: Optional[List[str]] = None
    overwrite: bool = False


class ExecutePipelineRequest(BaseModel):
    visualStyle: str = "cinematic"
    resolution: str = "720p"


class ExecutePipelineV2Request(BaseModel):
    visualStyle: str = "cinematic"
    resolution: str = "720p"
    forceRegenerateVideos: bool = False


# ---------------------------------------------------------------------------
# Monitor models
# ---------------------------------------------------------------------------

class ApiMonitorBudgetRequest(BaseModel):
    budgets: Dict[str, int] = Field(default_factory=dict)


class ApiMonitorVolcConfigRequest(BaseModel):
    access_key: Optional[str] = None
    secret_key: Optional[str] = None
    region: Optional[str] = None
    provider_code: Optional[str] = None
    quota_code: Optional[str] = None


class ApiMonitorConfigRequest(BaseModel):
    volcengine: ApiMonitorVolcConfigRequest = Field(default_factory=ApiMonitorVolcConfigRequest)


# ---------------------------------------------------------------------------
# Auth / Workspace / Collab models
# ---------------------------------------------------------------------------

class AuthRegisterRequest(BaseModel):
    email: str
    password: str
    name: str = ""


class AuthLoginRequest(BaseModel):
    email: str
    password: str


class AuthRefreshRequest(BaseModel):
    refresh_token: str


class AuthProfileUpdateRequest(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None


class AuthChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


class AuthForgotPasswordRequest(BaseModel):
    email: str


class AuthResetPasswordRequest(BaseModel):
    reset_token: str
    new_password: str


class WorkspaceCreateRequest(BaseModel):
    name: str


class WorkspaceMemberCreateRequest(BaseModel):
    email: str
    role: str = "viewer"


class WorkspaceMemberUpdateRequest(BaseModel):
    role: str


class WorkspaceOKRCreateRequest(BaseModel):
    title: str
    owner_user_id: Optional[str] = None
    status: str = "active"
    risk: str = "normal"
    due_date: str = ""
    key_results: Optional[List[Dict[str, Any]]] = None
    links: Optional[List[Dict[str, Any]]] = None


class WorkspaceOKRUpdateRequest(BaseModel):
    title: Optional[str] = None
    owner_user_id: Optional[str] = None
    status: Optional[str] = None
    risk: Optional[str] = None
    due_date: Optional[str] = None
    key_results: Optional[List[Dict[str, Any]]] = None
    links: Optional[List[Dict[str, Any]]] = None


class WorkspaceUndoRedoRequest(BaseModel):
    project_scope: str = "studio:global"


class WorkspaceEpisodeAssignRequest(BaseModel):
    assigned_to: str
    note: str = ""


class WorkspaceEpisodeReviewRequest(BaseModel):
    note: str = ""


# ---------------------------------------------------------------------------
# Studio models
# ---------------------------------------------------------------------------

class StudioSeriesCreateRequest(BaseModel):
    name: str
    script: str
    workspace_id: Optional[str] = None
    workbench_mode: str = "longform"
    description: str = ""
    series_bible: str = ""
    visual_style: str = ""
    target_episode_count: int = 0
    episode_duration_seconds: float = 90.0


class StudioSeriesUpdateRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    series_bible: Optional[str] = None
    visual_style: Optional[str] = None
    source_script: Optional[str] = None
    workspace_id: Optional[str] = None
    settings: Optional[Dict[str, Any]] = None


class StudioEpisodeUpdateRequest(BaseModel):
    title: Optional[str] = None
    summary: Optional[str] = None
    script_excerpt: Optional[str] = None
    target_duration_seconds: Optional[float] = None
    status: Optional[str] = None
    volume_id: Optional[str] = None


class StudioVolumeCreateRequest(BaseModel):
    volume_number: Optional[int] = None
    name: str = ""
    description: str = ""
    source_text: str = ""
    inherit_previous_anchor: bool = True


class StudioVolumeUpdateRequest(BaseModel):
    volume_number: Optional[int] = None
    name: Optional[str] = None
    description: Optional[str] = None
    source_text: Optional[str] = None
    style_anchor: Optional[Dict[str, Any]] = None
    status: Optional[str] = None


class StudioVolumeEpisodeCreateRequest(BaseModel):
    act_number: Optional[int] = None
    title: str = ""
    summary: str = ""
    script_excerpt: str = ""
    target_duration_seconds: float = 90.0
    status: str = "draft"


class StudioVolumeStyleAnchorExtractRequest(BaseModel):
    preferred_episode_id: Optional[str] = None


class StudioStyleMigrateRequest(BaseModel):
    source_volume_id: str
    target_volume_ids: Optional[List[str]] = None
    overwrite: bool = False


class StudioElementCreateRequest(BaseModel):
    name: str
    type: str = "character"
    description: str = ""
    voice_profile: str = ""
    is_favorite: int = 0


class StudioElementUpdateRequest(BaseModel):
    name: Optional[str] = None
    type: Optional[str] = None
    description: Optional[str] = None
    voice_profile: Optional[str] = None
    is_favorite: Optional[int] = None
    image_url: Optional[str] = None
    image_history: Optional[List[str]] = None
    reference_images: Optional[List[str]] = None


class StudioShotUpdateRequest(BaseModel):
    name: Optional[str] = None
    type: Optional[str] = None
    duration: Optional[float] = None
    description: Optional[str] = None
    prompt: Optional[str] = None
    end_prompt: Optional[str] = None
    video_prompt: Optional[str] = None
    narration: Optional[str] = None
    dialogue_script: Optional[str] = None
    sound_effects: Optional[str] = None
    segment_name: Optional[str] = None
    start_image_url: Optional[str] = None
    end_image_url: Optional[str] = None
    frame_history: Optional[List[str]] = None
    video_history: Optional[List[str]] = None
    visual_action: Optional[Dict[str, Any]] = None
    shot_size: Optional[str] = None
    camera_angle: Optional[str] = None
    camera_movement: Optional[str] = None
    emotion: Optional[str] = None
    emotion_intensity: Optional[int] = None
    key_frame_prompt: Optional[str] = None
    key_frame_url: Optional[str] = None
    scene_type: Optional[str] = None
    cinematography: Optional[Dict[str, Any]] = None
    acting_direction: Optional[Dict[str, Any]] = None


class StudioGenerateRequest(BaseModel):
    stage: str = "frame"  # frame / key_frame / end_frame / video / audio
    width: int = 1280
    height: int = 720
    voice_type: Optional[str] = None
    video_generate_audio: Optional[bool] = None


class StudioInpaintRequest(BaseModel):
    edit_prompt: str
    mask_data: Optional[str] = None
    width: Optional[int] = None
    height: Optional[int] = None


class StudioBatchGenerateRequest(BaseModel):
    stages: List[str] = ["elements", "frames", "key_frames", "end_frames", "videos", "audio"]
    parallel: Optional[Dict[str, Any]] = None
    video_generate_audio: Optional[bool] = None
    image_width: Optional[int] = Field(None, ge=128, le=4096)
    image_height: Optional[int] = Field(None, ge=128, le=4096)
    element_use_reference: Optional[bool] = None
    element_reference_mode: Optional[str] = "none"


class StudioReorderShotsRequest(BaseModel):
    shot_ids: List[str]


class StudioElementGenerateImageRequest(BaseModel):
    width: Optional[int] = None
    height: Optional[int] = None
    use_reference: bool = False
    reference_mode: str = "none"
    render_mode: str = "auto"
    max_images: int = Field(1, ge=1, le=15)
    steps: Optional[int] = Field(None, ge=10, le=60)
    seed: Optional[int] = None


class StudioCharacterDocImportRequest(BaseModel):
    document_text: str
    save_to_elements: bool = True
    dedupe_by_name: bool = True


class StudioCharacterSplitRequest(BaseModel):
    replace_original: bool = False


class StudioDigitalHumanProfileItem(BaseModel):
    id: Optional[str] = None
    base_name: str = ""
    display_name: str = ""
    stage_label: str = ""
    appearance: str = ""
    voice_profile: str = ""
    scene_template: str = ""
    lip_sync_style: str = ""
    sort_order: Optional[int] = None


class StudioDigitalHumanProfilesSaveRequest(BaseModel):
    profiles: List[StudioDigitalHumanProfileItem] = []


class StudioSettingsRequest(BaseModel):
    llm: Optional[Dict[str, Any]] = None
    image: Optional[Dict[str, Any]] = None
    video: Optional[Dict[str, Any]] = None
    tts: Optional[Dict[str, Any]] = None
    generation_defaults: Optional[Dict[str, Any]] = None
    custom_prompts: Optional[Dict[str, Any]] = None


class StudioPromptCheckItem(BaseModel):
    id: Optional[str] = None
    field: Optional[str] = None
    label: Optional[str] = None
    prompt: str = ""


class StudioPromptCheckRequest(BaseModel):
    prompt: Optional[str] = None
    items: Optional[List[StudioPromptCheckItem]] = None

    @model_validator(mode="after")
    def validate_payload(self):
        has_single = bool((self.prompt or "").strip())
        has_batch = bool(self.items and len(self.items) > 0)
        if has_single or has_batch:
            return self
        raise ValueError("prompt 或 items 至少提供一项")


class StudioPromptOptimizeRequest(BaseModel):
    prompt: str
    use_llm: bool = True


class StudioExportToAgentRequest(BaseModel):
    project_id: Optional[str] = None
    project_name: Optional[str] = None
    include_shared_elements: bool = True
    include_episode_elements: bool = True
    preserve_existing_messages: bool = True


class StudioKBWorldBibleRequest(BaseModel):
    art_style: str = ""
    era: str = ""
    color_palette: str = ""
    recurring_motifs: str = ""
    forbidden_elements: str = ""


class StudioKBMoodPackRequest(BaseModel):
    mood_key: str
    color_tokens: str = ""
    line_style_tokens: str = ""
    effect_tokens: str = ""
    combined_prompt: str = ""
    is_builtin: int = 0


class StudioImportFromAgentRequest(BaseModel):
    project_id: Optional[str] = None
    projectId: Optional[str] = None
    overwrite_episode_meta: bool = True
    import_elements: bool = True

    @model_validator(mode="after")
    def validate_payload(self):
        resolved = (self.project_id or self.projectId or "").strip()
        if resolved:
            self.project_id = resolved
            return self
        raise ValueError("project_id 不能为空")


# ---------------------------------------------------------------------------
# KB Phase 1 models
# ---------------------------------------------------------------------------

class KBCharacterCardUpdate(BaseModel):
    visual_tags: Optional[str] = None
    fixed_prompt: Optional[str] = None
    negative_prompt: Optional[str] = None
    is_locked: Optional[bool] = None
    notes: Optional[str] = None


class KBSceneCardUpdate(BaseModel):
    visual_tags: Optional[str] = None
    fixed_prompt: Optional[str] = None
    negative_prompt: Optional[str] = None
    is_locked: Optional[bool] = None
    notes: Optional[str] = None


class KBMoodPackCreate(BaseModel):
    mood_key: str
    color_tokens: str = ""
    line_style_tokens: str = ""
    effect_tokens: str = ""
    combined_prompt: str = ""
    is_builtin: int = 0


class KBWorldBibleUpdate(BaseModel):
    art_style: Optional[str] = None
    era: Optional[str] = None
    color_palette: Optional[str] = None
    recurring_motifs: Optional[str] = None
    forbidden_elements: Optional[str] = None


class KBAssemblePreviewRequest(BaseModel):
    series_id: str
    shot_id: Optional[str] = None
    element_ids: Optional[List[str]] = None
    mood_key: Optional[str] = None
    extra_tags: Optional[str] = None


# ---------------------------------------------------------------------------
# QA models
# ---------------------------------------------------------------------------

class QANarrativeRequest(BaseModel):
    pass  # episode_id is path param


class QAPromptRequest(BaseModel):
    pass  # shot_id is path param


class QAVisualRequest(BaseModel):
    pass  # shot_id is path param


class QAFullRequest(BaseModel):
    pass  # episode_id is path param


# ---------------------------------------------------------------------------
# Agent Pipeline models
# ---------------------------------------------------------------------------

class AgentPipelineStartRequest(BaseModel):
    pass  # episode_id is path param


class AgentPipelinePauseRequest(BaseModel):
    pass  # episode_id is path param


# ---------------------------------------------------------------------------
# Story State models
# ---------------------------------------------------------------------------

class StoryStateCharacterCreate(BaseModel):
    series_id: str
    element_id: str
    episode_id: str
    emotion: str = ""
    location: str = ""
    status: str = ""
    notes: str = ""


class StoryStateForeshadowingCreate(BaseModel):
    series_id: str
    episode_id: str
    hint_text: str = ""
    payoff_text: str = ""
    status: str = "planted"
    notes: str = ""


class StoryStateForeshadowingUpdate(BaseModel):
    hint_text: Optional[str] = None
    payoff_text: Optional[str] = None
    status: Optional[str] = None
    resolution_episode_id: Optional[str] = None
    notes: Optional[str] = None


class StoryStatePropagateRequest(BaseModel):
    series_id: str
    from_episode_id: str
    to_episode_id: str


# ---------------------------------------------------------------------------
# Project / Storyboard / Script models
# ---------------------------------------------------------------------------

class CreateProjectRequest(BaseModel):
    name: str
    description: str = ""


class UpdateProjectRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    reference_image: Optional[str] = None
    story_text: Optional[str] = None
    style: Optional[str] = None
    status: Optional[str] = None


class AddStoryboardRequest(BaseModel):
    prompt: str
    full_prompt: str = ""
    image_url: str = ""
    index: int = -1


class UpdateStoryboardRequest(BaseModel):
    prompt: Optional[str] = None
    full_prompt: Optional[str] = None
    image_url: Optional[str] = None
    status: Optional[str] = None
    index_num: Optional[int] = None


class SaveScriptRequest(BaseModel):
    title: str
    content: str
    project_id: Optional[str] = None


class UpdateScriptRequest(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None


# ---------------------------------------------------------------------------
# Export / Import models
# ---------------------------------------------------------------------------

class ExportAllRequest(BaseModel):
    include_projects: bool = True
    include_scripts: bool = True
    include_images: bool = True
    include_settings: bool = True


class ImportProjectRequest(BaseModel):
    overwrite: bool = False
