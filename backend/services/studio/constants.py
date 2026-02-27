"""Studio 专业影视制作常量

对标 prompt_i18n.go 的专业影视词汇体系，为 Studio 建立统一的景别、运镜、
机位角度、情绪强度等标准。所有提示词模板和前端 UI 组件从此处引用。
"""

from typing import Any, Dict

# ---------------------------------------------------------------------------
# 专业景别标准（对标 prompt_i18n.go 的 6 级景别）
# ---------------------------------------------------------------------------
SHOT_SIZE_STANDARDS: Dict[str, Dict[str, str]] = {
    "extreme_long": {
        "zh": "大远景",
        "en": "Extreme Long Shot (ELS)",
        "usage": "环境、氛围营造、建立镜头",
    },
    "long": {
        "zh": "远景/全景",
        "en": "Long Shot (LS)",
        "usage": "全身动作、空间关系",
    },
    "medium": {
        "zh": "中景",
        "en": "Medium Shot (MS)",
        "usage": "交互对话、情感交流",
    },
    "medium_close": {
        "zh": "中近景",
        "en": "Medium Close-Up (MCU)",
        "usage": "半身取景、对话重点",
    },
    "close_up": {
        "zh": "近景/特写",
        "en": "Close-Up (CU)",
        "usage": "细节展示、情绪表达",
    },
    "extreme_close": {
        "zh": "大特写",
        "en": "Extreme Close-Up (ECU)",
        "usage": "关键道具、强烈情绪",
    },
}

# ---------------------------------------------------------------------------
# 运镜方式（对齐 Go 文件 + visual_action 已有词汇）
# ---------------------------------------------------------------------------
CAMERA_MOVEMENTS: Dict[str, Dict[str, str]] = {
    "fixed": {
        "zh": "固定镜头",
        "en": "Fixed Shot",
        "desc": "稳定聚焦于一个主体",
    },
    "push": {
        "zh": "推镜",
        "en": "Push In",
        "desc": "接近主体，增强紧张感",
    },
    "pull": {
        "zh": "拉镜",
        "en": "Pull Out",
        "desc": "扩大视野，交代环境",
    },
    "pan": {
        "zh": "摇镜",
        "en": "Pan",
        "desc": "水平移动，空间转换",
    },
    "follow": {
        "zh": "跟镜",
        "en": "Follow",
        "desc": "跟随主体移动",
    },
    "tracking": {
        "zh": "移镜",
        "en": "Tracking Shot",
        "desc": "与主体同向移动",
    },
    "orbit": {
        "zh": "环绕",
        "en": "Orbit",
        "desc": "围绕主体旋转拍摄",
    },
}

# ---------------------------------------------------------------------------
# 机位角度
# ---------------------------------------------------------------------------
CAMERA_ANGLES: Dict[str, Dict[str, str]] = {
    "eye_level": {"zh": "平视", "en": "Eye Level"},
    "low_angle": {"zh": "仰拍", "en": "Low Angle"},
    "high_angle": {"zh": "俯拍", "en": "High Angle"},
    "dutch": {"zh": "荷兰角", "en": "Dutch Angle"},
    "overhead": {"zh": "顶拍", "en": "Overhead/Bird's Eye"},
    "side": {"zh": "侧面", "en": "Side View"},
    "back": {"zh": "背面", "en": "Back View"},
}

# ---------------------------------------------------------------------------
# 情绪强度等级（对标 Go 文件的 5 级系统）
# ---------------------------------------------------------------------------
EMOTION_INTENSITY: Dict[int, Dict[str, str]] = {
    3: {"zh": "极强 ↑↑↑", "en": "Extremely Strong ↑↑↑", "desc": "情绪高峰、高度紧张"},
    2: {"zh": "强 ↑↑", "en": "Strong ↑↑", "desc": "情绪明显波动"},
    1: {"zh": "中 ↑", "en": "Moderate ↑", "desc": "情绪有所变化"},
    0: {"zh": "平稳 →", "en": "Stable →", "desc": "情绪不变"},
    -1: {"zh": "弱 ↓", "en": "Weak ↓", "desc": "情绪回落"},
}

# ---------------------------------------------------------------------------
# 帧生成通用负面提示词
# ---------------------------------------------------------------------------
DEFAULT_NEGATIVE_PROMPT = (
    "blurry, low quality, distorted, deformed, inconsistent character, "
    "different art style, multiple panels, comic layout, split screen, "
    "collage, poster layout, text, watermark, subtitle, signature, "
    "3D render, photorealistic photo, chibi cartoon"
)

# ---------------------------------------------------------------------------
# 情绪强度映射辅助
# ---------------------------------------------------------------------------
EMOTION_INTENSITY_LABEL_ZH: Dict[int, str] = {
    3: "极强",
    2: "强",
    1: "中",
    0: "平稳",
    -1: "弱",
}


def get_shot_size_zh(key: str) -> str:
    """获取景别中文名称。"""
    entry = SHOT_SIZE_STANDARDS.get(key)
    return entry["zh"] if entry else key


def get_camera_movement_zh(key: str) -> str:
    """获取运镜方式中文名称。"""
    entry = CAMERA_MOVEMENTS.get(key)
    return entry["zh"] if entry else key


def get_camera_movement_desc(key: str) -> str:
    """获取运镜方式描述。"""
    entry = CAMERA_MOVEMENTS.get(key)
    return entry.get("desc", "") if entry else ""


def get_camera_angle_zh(key: str) -> str:
    """获取机位角度中文名称。"""
    entry = CAMERA_ANGLES.get(key)
    return entry["zh"] if entry else key


def get_emotion_intensity_zh(level: int) -> str:
    """获取情绪强度中文标签。"""
    return EMOTION_INTENSITY_LABEL_ZH.get(level, "中")
