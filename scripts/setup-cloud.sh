#!/usr/bin/env bash
set -euo pipefail
cd /workspace/TimbreSpaceSynth
python3 -m pip install --target /workspace/tools --upgrade cmake==4.4.4
mkdir -p /workspace/deps
if [ ! -d /workspace/deps/JUCE/.git ]; then
  git clone --depth 1 --branch 9.0.3 https://github.com/juce-framework/JUCE.git /workspace/deps/JUCE
fi
[ "$(git -C /workspace/deps/JUCE rev-parse HEAD)" = be29c81492b6151c8ea8d14c840e1311963b3a83 ]
# Use signed Debian metadata and package hashes, extracting headers locally without sudo.
mkdir -p /workspace/apt/lists/partial /workspace/apt/cache/archives/partial /workspace/apt/conf /workspace/native/root
cat > /workspace/apt/apt.conf <<'CONFIG'
Dir::Etc::parts "/workspace/apt/conf";
Dir::Etc::sourcelist "/workspace/apt/sources.list";
Dir::Etc::sourceparts "/workspace/apt/conf";
Dir::State::lists "/workspace/apt/lists";
Dir::Cache "/workspace/apt/cache";
CONFIG
cat > /workspace/apt/sources.list <<'SOURCES'
deb [signed-by=/usr/share/keyrings/debian-archive-keyring.gpg] https://deb.debian.org/debian trixie main
SOURCES
export APT_CONFIG=/workspace/apt/apt.conf
apt-get update
(cd /workspace/native && apt-get download libasound2-dev libfreetype-dev libfontconfig-dev \
  libx11-dev libxext-dev libxrandr-dev libxinerama-dev libxcursor-dev libxrender-dev \
  libxfixes-dev libxi-dev libgl-dev libglx-dev libegl-dev x11proto-dev libpng-dev \
  libbrotli-dev libbz2-dev libxau-dev libxdmcp-dev libxcb1-dev libpthread-stubs0-dev)
python3 - <<'PY'
import glob, os, subprocess
for file in glob.glob('/workspace/native/*.deb'):
    subprocess.run(['dpkg-deb', '-x', file, '/workspace/native/root'], check=True)
# Runtime libraries are supplied by the cloud base image. Fail rather than create
# unverified replacements if any required library is unavailable during linking.
for file in glob.glob('/workspace/native/root/usr/lib/x86_64-linux-gnu/*.so'):
    if os.path.islink(file) and not os.path.exists(file):
        runtime = '/usr/lib/x86_64-linux-gnu/' + os.path.basename(os.readlink(file))
        if os.path.exists(runtime):
            os.unlink(file)
            os.symlink(runtime, file)
PY
export PKG_CONFIG_SYSROOT_DIR=/workspace/native/root
export PKG_CONFIG_PATH=/workspace/native/root/usr/lib/x86_64-linux-gnu/pkgconfig:/workspace/native/root/usr/share/pkgconfig
cmake_bin=/workspace/tools/cmake/data/bin/cmake
"$cmake_bin" -S . -B build -DJUCE_SOURCE_DIR=/workspace/deps/JUCE -DCMAKE_BUILD_TYPE=Debug \
  -DCMAKE_CXX_FLAGS=-I/workspace/native/root/usr/include \
  -DCMAKE_C_FLAGS=-I/workspace/native/root/usr/include \
  -DCMAKE_LIBRARY_PATH=/workspace/native/root/usr/lib/x86_64-linux-gnu
"$cmake_bin" --build build --parallel 3
/workspace/tools/cmake/data/bin/ctest --test-dir build --output-on-failure
npm ci --prefix SpiralExplorer --cache /workspace/npm-cache --no-audit --no-fund
npm test --prefix SpiralExplorer
npm run build --prefix SpiralExplorer
