"""Pydantic 数据模型定义"""

from pydantic import BaseModel, Field
from typing import List, Optional, Literal
from datetime import datetime


class LoginRequest(BaseModel):
    password: str


class AdviceRequest(BaseModel):
    position_id: str = Field(min_length=1, max_length=128)


class TokenResponse(BaseModel):
    token: str
    expires_in: int  # 秒


class ModelCreate(BaseModel):
    name: str
    api_key: str
    base_url: str = "https://api.deepseek.com"
    model_name: str = "deepseek-v4-pro"


class ModelConfig(BaseModel):
    id: str
    name: str
    api_key: str
    base_url: str
    model_name: str


class ModelConfigPublic(BaseModel):
    """不暴露 api_key 的模型配置"""
    id: str
    name: str
    base_url: str
    model_name: str


class AIPlayerConfig(BaseModel):
    name: str
    style: str       # 激进/保守/均衡/诈唬/诡计
    model_id: str = ""    # 引用 ModelConfig.id，human 可为空
    player_type: Literal["ai", "human"] = "ai"
    controller_id: str = "admin"


class GameConfig(BaseModel):
    players: List[AIPlayerConfig]
    big_blind: int = 100
    starting_chips: int = 10000
    max_hands: int = 10
    action_delay: float = 2.0
    eliminate_on_zero: bool = True
    blind_increase_interval: int = 0


class GameEvent(BaseModel):
    type: str
    data: dict = {}
    timestamp: Optional[str] = None

    def __init__(self, **kwargs):
        if "timestamp" not in kwargs or kwargs["timestamp"] is None:
            kwargs["timestamp"] = datetime.now().isoformat()
        super().__init__(**kwargs)
