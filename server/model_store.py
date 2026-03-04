"""模型配置持久化存储：读写 data/models.json"""

import json
import uuid
import asyncio
from pathlib import Path
from typing import List, Optional

from server.schemas import ModelConfig, ModelCreate


DATA_DIR = Path(__file__).parent.parent / "data"
MODELS_FILE = DATA_DIR / "models.json"


class ModelStore:
    """模型配置 CRUD 存储"""

    def __init__(self):
        self._lock = asyncio.Lock()
        self._ensure_data_dir()

    def _ensure_data_dir(self):
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        if not MODELS_FILE.exists():
            MODELS_FILE.write_text("[]", encoding="utf-8")

    def _read_all(self) -> List[dict]:
        try:
            content = MODELS_FILE.read_text(encoding="utf-8")
            return json.loads(content)
        except (json.JSONDecodeError, FileNotFoundError):
            return []

    def _write_all(self, models: List[dict]):
        MODELS_FILE.write_text(
            json.dumps(models, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    async def list_all(self) -> List[ModelConfig]:
        async with self._lock:
            data = self._read_all()
            return [ModelConfig(**m) for m in data]

    async def get_by_id(self, model_id: str) -> Optional[ModelConfig]:
        async with self._lock:
            data = self._read_all()
            for m in data:
                if m["id"] == model_id:
                    return ModelConfig(**m)
            return None

    async def create(self, model: ModelCreate) -> ModelConfig:
        async with self._lock:
            data = self._read_all()
            new_model = {
                "id": str(uuid.uuid4())[:8],
                "name": model.name,
                "api_key": model.api_key,
                "base_url": model.base_url,
                "model_name": model.model_name,
            }
            data.append(new_model)
            self._write_all(data)
            return ModelConfig(**new_model)

    async def update(self, model_id: str, model: ModelCreate) -> Optional[ModelConfig]:
        async with self._lock:
            data = self._read_all()
            for i, m in enumerate(data):
                if m["id"] == model_id:
                    data[i] = {
                        "id": model_id,
                        "name": model.name,
                        "api_key": model.api_key,
                        "base_url": model.base_url,
                        "model_name": model.model_name,
                    }
                    self._write_all(data)
                    return ModelConfig(**data[i])
            return None

    async def delete(self, model_id: str) -> bool:
        async with self._lock:
            data = self._read_all()
            new_data = [m for m in data if m["id"] != model_id]
            if len(new_data) == len(data):
                return False
            self._write_all(new_data)
            return True


# 全局单例
model_store = ModelStore()
