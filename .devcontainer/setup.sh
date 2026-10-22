#!/usr/bin/env bash
set -euo pipefail

npm ci

# Chromium 본체와 실행에 필요한 시스템 라이브러리
npx playwright install --with-deps chromium

# 한국어·일본어 페이지 글자가 깨지지 않도록 CJK 폰트 설치
sudo apt-get install -y --no-install-recommends fonts-noto-cjk
