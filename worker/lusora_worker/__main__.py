from .config import WorkerConfig
from .pipeline.orchestrator import run_forever

if __name__ == "__main__":
    run_forever(WorkerConfig.from_env())
