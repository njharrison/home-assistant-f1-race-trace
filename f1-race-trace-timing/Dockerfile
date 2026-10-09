ARG BUILD_FROM=ghcr.io/home-assistant/aarch64-base-python:3.13-alpine3.21
FROM ${BUILD_FROM}

RUN apk add --no-cache py3-pandas py3-numpy py3-scipy py3-requests py3-packaging && \
    python3 -m venv --system-site-packages /opt/venv && \
    /opt/venv/bin/pip install --no-cache-dir 'fastf1>=3.4,<4'

COPY run.py /run.py
CMD ["/opt/venv/bin/python", "/run.py"]
