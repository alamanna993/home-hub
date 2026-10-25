FROM python:3.12-slim

# Codex CLI — Emerald's primary brain, signed in with a ChatGPT subscription.
# Standalone musl build, so no Node runtime is needed. Sign-in lives in CODEX_HOME
# (a named volume in docker-compose.yml) and survives image updates.
ARG CODEX_VERSION=0.160.0
ENV CODEX_HOME=/data/codex
# codex-code-mode-host is a separate download; Codex routes every tool call (including
# HomeHub's MCP tools) through it and refuses tools without it.
RUN python - <<'EOF'
import io, os, platform, tarfile, urllib.request
arch = {"x86_64": "x86_64", "amd64": "x86_64", "aarch64": "aarch64", "arm64": "aarch64"}[platform.machine().lower()]
for binary in ("codex", "codex-code-mode-host"):
    name = f"{binary}-{arch}-unknown-linux-musl"
    url = f"https://github.com/openai/codex/releases/download/rust-v{os.environ['CODEX_VERSION']}/{name}.tar.gz"
    with tarfile.open(fileobj=io.BytesIO(urllib.request.urlopen(url).read())) as tar:
        member = next(m for m in tar.getmembers() if m.isfile())
        with open(f"/usr/local/bin/{binary}", "wb") as out:
            out.write(tar.extractfile(member).read())
    os.chmod(f"/usr/local/bin/{binary}", 0o755)
os.makedirs(os.environ["CODEX_HOME"], exist_ok=True)
EOF

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
