FROM python:3.11-slim

# Install system dependencies for PostgreSQL, GDAL, and OpenCV
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    libgl1 \
    libglib2.0-0 \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Copy backend application code
COPY vigilance-prototype/backend /app/vigilance-prototype/backend
COPY vigilance-prototype/edge /app/vigilance-prototype/edge

WORKDIR /app/vigilance-prototype/backend

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
