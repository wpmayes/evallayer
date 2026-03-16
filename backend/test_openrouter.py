import asyncio
import httpx
import os
from dotenv import load_dotenv
load_dotenv()

async def test():
    token = os.getenv("HUGGINGFACE_TOKEN", "")
    print("Token present:", bool(token))
    
    model_id = "HuggingFaceH4/zephyr-7b-beta"
    model_with_provider = f"{model_id}:featherless-ai"
    
    url = "https://router.huggingface.co/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": model_with_provider,
        "messages": [
            {"role": "system", "content": "You are a helpful assistant."},
            {"role": "user", "content": "What is 2 + 2? Answer with just the number."},
        ],
        "temperature": 0.7,
        "max_tokens": 10,
    }
    
    print("Sending payload:", payload)
    
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(url, headers=headers, json=payload)
        print("Status:", resp.status_code)
        print("Body:", resp.text)

asyncio.run(test())