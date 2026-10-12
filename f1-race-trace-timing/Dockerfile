ARG BUILD_FROM=ghcr.io/home-assistant/aarch64-base:3.22
FROM ${BUILD_FROM}

# Use Alpine's precompiled scientific Python packages on ARM64.
# The venv inherits these via --system-site-packages, avoiding a source
# compilation of matplotlib and its native dependencies.
RUN apk add --no-cache python3 py3-pip py3-pandas py3-numpy py3-scipy \
    py3-matplotlib py3-requests py3-packaging py3-cryptography \
    py3-dateutil py3-tzdata py3-websocket-client && \
    python3 -m venv --system-site-packages /opt/venv && \
    /opt/venv/bin/pip install --no-cache-dir --prefer-binary 'fastf1>=3.4,<4'

COPY run.py /run.py
COPY recorder.py /recorder.py
COPY gps_recorder.py /gps_recorder.py
COPY start.py /start.py
CMD ["/usr/bin/with-contenv", "/opt/venv/bin/python", "/start.py"]
