"""Shared location for durable application data."""
import os
from pathlib import Path

DATA_DIR = Path(os.environ.get('PIZARRA_DATA_DIR') or
                Path(__file__).resolve().parent.parent / 'datos').expanduser().resolve()
