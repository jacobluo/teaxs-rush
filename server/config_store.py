"""游戏配置持久化存储：读写 data/game_config.json（含玩家信息和游戏参数）"""

import json
import asyncio
from pathlib import Path
from typing import Optional

DATA_DIR = Path(__file__).parent.parent / "data"
CONFIG_FILE = DATA_DIR / "game_config.json"


class ConfigStore:
    """游戏配置持久化 CRUD"""

    def __init__(self):
        self._lock = asyncio.Lock()
        self._ensure_data_dir()

    def _ensure_data_dir(self):
        DATA_DIR.mkdir(parents=True, exist_ok=True)

    def _read(self) -> Optional[dict]:
        try:
            if CONFIG_FILE.exists():
                content = CONFIG_FILE.read_text(encoding="utf-8")
                return json.loads(content)
        except (json.JSONDecodeError, FileNotFoundError):
            pass
        return None

    def _write(self, config: dict):
        CONFIG_FILE.write_text(
            json.dumps(config, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    async def save(self, config: dict):
        """保存游戏配置"""
        async with self._lock:
            self._write(config)

    async def load(self) -> Optional[dict]:
        """加载已保存的游戏配置"""
        async with self._lock:
            return self._read()


# 全局单例
config_store = ConfigStore()
