# Source from Bash before configuring/rebuilding JUCE in the prepared Linux image.
export PATH="/workspace/tools/cmake/data/bin:$PATH"
export PKG_CONFIG_SYSROOT_DIR=/workspace/native/root
export PKG_CONFIG_PATH=/workspace/native/root/usr/lib/x86_64-linux-gnu/pkgconfig:/workspace/native/root/usr/share/pkgconfig
