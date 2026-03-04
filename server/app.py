"""FastAPI 路由定义：认证、模型管理、游戏控制、WebSocket"""

import json
import logging
from typing import List

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends, HTTPException

from server.auth import verify_password, create_token, verify_token, get_current_admin, TOKEN_EXPIRE_HOURS
from server.schemas import (
    LoginRequest, TokenResponse,
    ModelCreate, ModelConfig, ModelConfigPublic,
    GameConfig,
)
from server.model_store import model_store
from server.config_store import config_store
from server.game_manager import game_manager

logger = logging.getLogger(__name__)

router = APIRouter()


# ========== 认证 API ==========

@router.post("/api/auth/login", response_model=TokenResponse)
async def login(request: LoginRequest):
    if not verify_password(request.password):
        raise HTTPException(status_code=401, detail="密码错误")
    token = create_token()
    return TokenResponse(
        token=token,
        expires_in=TOKEN_EXPIRE_HOURS * 3600,
    )


@router.get("/api/auth/verify")
async def verify_auth(admin: str = Depends(get_current_admin)):
    return {"status": "ok", "role": "admin"}


# ========== 模型管理 API（管理员专属）==========

@router.get("/api/models", response_model=List[ModelConfigPublic])
async def list_models(admin: str = Depends(get_current_admin)):
    models = await model_store.list_all()
    return [
        ModelConfigPublic(
            id=m.id, name=m.name,
            base_url=m.base_url, model_name=m.model_name,
        )
        for m in models
    ]


@router.post("/api/models", response_model=ModelConfigPublic)
async def create_model(model: ModelCreate, admin: str = Depends(get_current_admin)):
    created = await model_store.create(model)
    return ModelConfigPublic(
        id=created.id, name=created.name,
        base_url=created.base_url, model_name=created.model_name,
    )


@router.put("/api/models/{model_id}", response_model=ModelConfigPublic)
async def update_model(
    model_id: str,
    model: ModelCreate,
    admin: str = Depends(get_current_admin),
):
    updated = await model_store.update(model_id, model)
    if not updated:
        raise HTTPException(status_code=404, detail="模型不存在")
    return ModelConfigPublic(
        id=updated.id, name=updated.name,
        base_url=updated.base_url, model_name=updated.model_name,
    )


@router.delete("/api/models/{model_id}")
async def delete_model(model_id: str, admin: str = Depends(get_current_admin)):
    deleted = await model_store.delete(model_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="模型不存在")
    return {"status": "ok"}


# ========== 游戏配置 API（管理员专属）==========

@router.get("/api/game/saved-config")
async def get_saved_config(admin: str = Depends(get_current_admin)):
    """获取上次保存的游戏配置（含玩家信息和游戏参数）"""
    config = await config_store.load()
    if not config:
        return {"status": "empty", "config": None}
    return {"status": "ok", "config": config}


@router.post("/api/game/config")
async def configure_game(config: GameConfig, admin: str = Depends(get_current_admin)):
    if len(config.players) < 2:
        raise HTTPException(status_code=400, detail="至少需要 2 个玩家")
    if len(config.players) > 9:
        raise HTTPException(status_code=400, detail="最多 9 个玩家")
    await game_manager.configure_game(config)
    return {"status": "ok"}


@router.get("/api/game/state")
async def get_game_state():
    return game_manager.get_state()


# ========== WebSocket ==========

@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await game_manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            try:
                message = json.loads(data)
                msg_type = message.get("type", "")
                token = message.get("token", "")

                # 游戏控制消息需要验证 token
                if msg_type in ("start", "pause", "resume", "step", "reset"):
                    if not verify_token(token):
                        await websocket.send_json({
                            "type": "error",
                            "data": {"message": "需要管理员权限"},
                        })
                        continue

                    if msg_type == "start":
                        await game_manager.start_game()
                    elif msg_type == "pause":
                        await game_manager.pause_game()
                    elif msg_type == "resume":
                        await game_manager.resume_game()
                    elif msg_type == "step":
                        await game_manager.step_game()
                    elif msg_type == "reset":
                        await game_manager.reset_game()

            except json.JSONDecodeError:
                pass

    except WebSocketDisconnect:
        game_manager.disconnect(websocket)
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        game_manager.disconnect(websocket)
