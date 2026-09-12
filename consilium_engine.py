#!/usr/bin/env python3
"""
Evaline Consilium Engine - Линейный консилиум LLM агентов.
Построчный чат, где агенты по цепочке обсуждают задачи завода Evaline.
"""

import os
import sys
import json
import time
import urllib.request
import urllib.error

ENV_PATH = "/var/www/evabot-backend/.env"
def load_env():
    env = {}
    if os.path.exists(ENV_PATH):
        with open(ENV_PATH, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    env[k.strip()] = v.strip().strip("'\"")
    return env

ENV = load_env()
OPENROUTER_API_KEY = ENV.get("OPENROUTER_API_KEY", "")
GEMINI_API_KEY = ENV.get("GEMINI_API_KEY", "")
OMNIROUTE_API_KEY = ENV.get("OMNIROUTE_API_KEY", "")
OMNIROUTE_BASE = "http://100.66.98.4:20128/v1"

# Список агентов и их модели
AGENTS = [
    {
        "id": "Agent-01",
        "name": "Главный технолог ЭВА",
        "role": "Контроль рецептур, плотность (50-250 кг/м³), твердость по Шору, автоковрики ромб/соты.",
        "model": "meta-llama/llama-3.3-70b-instruct:free",
        "provider": "openrouter"
    },
    {
        "id": "Agent-02",
        "name": "Инженер спортпокрытий (Татами)",
        "role": "Замки ласточкин хвост, мягкий пол, плотность для единоборств и детских зон.",
        "model": "google/gemini-2.0-flash-exp:free",
        "provider": "openrouter"
    },
    {
        "id": "Agent-03",
        "name": "Директор по логистике (ЕС и Украина)",
        "role": "Склад в Братиславе, завод в Черноморске, таможня, оптовые поставки рулонов и листов.",
        "model": "qwen/qwen-2.5-72b-instruct:free",
        "provider": "openrouter"
    },
    {
        "id": "Agent-04",
        "name": "Скептик / Аудитор рисков",
        "role": "Ищет технологический брак, финансовые просадки, нереалистичные сроки.",
        "model": "deepseek/deepseek-r1:free",
        "provider": "openrouter"
    },
    {
        "id": "Agent-05",
        "name": "Председатель Консилиума (Синтез)",
        "role": "Подводит итог обсуждения, формирует финальную директиву для руководства Evaline.",
        "model": "google/gemini-2.5-flash",
        "provider": "omniroute"
    }
]

def call_openrouter(model, messages):
    url = "https://openrouter.ai/api/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://evaline.online",
        "X-Title": "Evaline Consilium"
    }
    payload = {
        "model": model,
        "messages": messages,
        "max_tokens": 200,
        "temperature": 0.7
    }
    req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"), headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return data["choices"][0]["message"]["content"].strip()
    except Exception as e:
        return f"[Ошибка связи с {model}: {e}]"

def call_omniroute(model, messages):
    url = f"{OMNIROUTE_BASE}/chat/completions"
    headers = {
        "Authorization": f"Bearer {OMNIROUTE_API_KEY}",
        "Content-Type": "application/json"
    }
    payload = {
        "model": model,
        "messages": messages,
        "max_tokens": 200,
        "temperature": 0.7
    }
    req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"), headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return data["choices"][0]["message"]["content"].strip()
    except Exception as e:
        # Fallback to OpenRouter free if local omniroute is down
        return call_openrouter("google/gemini-2.0-flash-exp:free", messages)

def run_consilium_turn(topic):
    print(f"\n=======================================================")
    print(f"🏛️  ЗАСЕДАНИЕ КОНСИЛИУМА EVALINE")
    print(f"Повестка: {topic}")
    print(f"=======================================================\n")

    transcript = []
    
    for agent in AGENTS:
        print(f"⏳ Выступает {agent['id']} [{agent['name']}] (модель: {agent['model']})...")
        sys.stdout.flush()

        system_prompt = (
            f"Ты {agent['id']} — {agent['name']} в компании EvaLine (производство ЭВА полимеров, г. Черноморск).\n"
            f"Твоя роль: {agent['role']}\n"
            f"Формат ответа: кратко (2-4 предложения), строго по делу, опираясь на технологии ЭВА и контекст предыдущих коллег."
        )

        history_text = "\n".join([f"{entry['speaker']}: {entry['text']}" for entry in transcript])
        user_prompt = f"Повестка дня: {topic}\n\nИстория выступлений предыдущих членов консилиума:\n{history_text if history_text else '(Вы открываете заседание)'}\n\nТвоё слово:"

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ]

        if agent["provider"] == "omniroute":
            reply = call_omniroute(agent["model"], messages)
        else:
            reply = call_openrouter(agent["model"], messages)

        print(f"\n💬 [{agent['id']} | {agent['name']}]:")
        print(f"{reply}\n")
        print("-" * 55)

        transcript.append({
            "agent_id": agent["id"],
            "speaker": f"{agent['id']} ({agent['name']})",
            "text": reply,
            "model": agent["model"]
        })
        time.sleep(1)

    log_path = "/home/evabot/evaline-consilium/consilium_last_session.json"
    with open(log_path, "w", encoding="utf-8") as f:
        json.dump({"topic": topic, "transcript": transcript}, f, ensure_ascii=False, indent=2)
    print(f"\n✅ Заседание завершено. Протокол сохранен в: {log_path}\n")

if __name__ == "__main__":
    topic = " ".join(sys.argv[1:]) if len(sys.argv) > 1 else "Запуск новой экструзионной линии ЭВА листов повышенной износостойкости для автоковриков и склада в Братиславе."
    run_consilium_turn(topic)
