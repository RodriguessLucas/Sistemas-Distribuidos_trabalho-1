FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    HF_HOME=/cache/huggingface \
    OMP_NUM_THREADS=1 \
    OPENBLAS_NUM_THREADS=1

WORKDIR /app
COPY requirements-docker.txt .
RUN pip install --no-cache-dir -r requirements-docker.txt
COPY codigo /app/codigo
COPY dashboard /app/dashboard
WORKDIR /app/codigo/start
RUN python -m grpc_tools.protoc -I. --python_out=. --grpc_python_out=. federated.proto

EXPOSE 50051
CMD ["python", "student_fl_server_grpc.py", "--host", "0.0.0.0"]
