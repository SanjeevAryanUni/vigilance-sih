#!/bin/bash
echo "================================================================"
echo "🛡️  VIGILANCE — Urban Road Intelligence Prototype Launcher"
echo "================================================================"

ROOT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$ROOT_DIR"

# 1. Start Celery Async Worker Process
echo "Starting Celery Background Deduplication Worker..."
python3 -m celery -A backend.celery_app worker --loglevel=info --pool=solo &
CELERY_PID=$!

sleep 1

# 2. Start FastAPI Backend on Port 8000
echo "Starting FastAPI Server on http://localhost:8000 ..."
python3 -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!

sleep 2

# 3. Seed Database with initial Chennai road nodes
echo "Seeding initial Chennai transit detections with dynamic RPI..."
python3 backend/seed_data.py

# 4. Start Next.js 14 WebGIS Dashboard on Port 3000
echo "Starting Next.js 14 WebGIS Dashboard on http://localhost:3000 ..."
if [ -d "$ROOT_DIR/dashboard-next" ]; then
    cd "$ROOT_DIR/dashboard-next"
    npm run dev -- -p 3000 &
    DASHBOARD_PID=$!
    cd "$ROOT_DIR"
fi

# 5. Start Simulated Fleet Stream in background
echo "Starting Simulated Fleet Edge AI Stream (5 Virtual Buses)..."
python3 edge/simulate_fleet.py &
FLEET_PID=$!

echo "================================================================"
echo "✨ VIGILANCE Prototype is LIVE!"
echo "👉 Dashboard URL: http://localhost:3000"
echo "👉 REST API Docs: http://localhost:8000/docs"
echo "================================================================"

# Cross-platform browser opener
sleep 3
case "$(uname -s)" in
  Darwin)
    open "http://localhost:3000" 2>/dev/null || true
    ;;
  Linux)
    xdg-open "http://localhost:3000" 2>/dev/null || echo "Please open http://localhost:3000 in your browser"
    ;;
  *)
    echo "Please open http://localhost:3000 in your browser"
    ;;
esac

# Wait and handle cleanup
trap "kill $BACKEND_PID $DASHBOARD_PID $FLEET_PID $CELERY_PID 2>/dev/null" EXIT
wait
