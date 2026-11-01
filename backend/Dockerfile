FROM python:3.12-slim

WORKDIR /app

# System deps for Qiskit visualization
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc g++ cmake curl \
    libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir --prefer-binary -r requirements.txt

COPY . .

EXPOSE 8000

# A worker loading its routers on a slow or busy host can miss uvicorn's 5 s healthcheck and be
# killed mid-request; 120 s still replaces a genuinely stuck one.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2", "--timeout-keep-alive", "75", "--timeout-worker-healthcheck", "120"]
