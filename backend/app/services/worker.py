import asyncio
from app.routers.runs import _execute_run

async def run_worker(run_id: int):
    await _execute_run(run_id)

if __name__ == "__main__":
    import sys
    run_id = int(sys.argv[1])
    asyncio.run(run_worker(run_id))