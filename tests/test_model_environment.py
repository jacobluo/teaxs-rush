import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from server.model_store import ModelStore


class EnvironmentModelTests(unittest.IsolatedAsyncioTestCase):
    async def test_imports_dotenv_alias_and_updates_same_model_on_key_rotation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            env = root / '.env'
            env.write_text('DeepSeekKey=test-secret-one\n')
            models = root / 'models.json'
            models.write_text('[]')
            with patch('server.model_store.DATA_DIR', root), patch('server.model_store.MODELS_FILE', models), patch.dict(os.environ, {}, clear=True):
                store = ModelStore()
                first = await store.sync_environment_model(env)
                self.assertEqual(first.model_name, 'deepseek-v4-pro')
                self.assertEqual(first.base_url, 'https://api.deepseek.com')
                self.assertEqual(first.api_key, 'test-secret-one')
                env.write_text('DEEPSEEK_API_KEY=test-secret-two\n')
                second = await store.sync_environment_model(env)
                self.assertEqual(first.id, second.id)
                self.assertEqual(second.api_key, 'test-secret-two')
                self.assertEqual(len(await store.list_all()), 1)

    async def test_missing_key_does_not_create_an_unusable_model(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with patch('server.model_store.DATA_DIR', root), patch('server.model_store.MODELS_FILE', root / 'models.json'), patch.dict(os.environ, {}, clear=True):
                store = ModelStore()
                self.assertIsNone(await store.sync_environment_model(root / '.env'))
                self.assertEqual(await store.list_all(), [])
