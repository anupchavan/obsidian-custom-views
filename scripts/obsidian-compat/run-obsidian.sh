#!/usr/bin/env bash
# Starts Obsidian on a throwaway test vault with this build of Custom Views installed.
# Usage: run-obsidian.sh <obsidian-X.asar[.gz]> <Obsidian-installer.AppImage> <version>
# Needs xvfb-run. Prints nothing useful itself; e2e.mjs connects on port 9222.
set -euo pipefail
asar="$1"; appimage="$2"; version="$3"
root="$(cd "$(dirname "$0")/../.." && pwd)"
work="${RUNNER_TEMP:-$(mktemp -d)}/obsidian-e2e"
rm -rf "$work"; mkdir -p "$work"
vault="$work/vault"; config="$work/config"

mkdir -p "$vault/Movies" "$vault/.obsidian/plugins/custom-views" "$config/obsidian"
printf -- '---\nrating: 4\n---\nA linguist meets visitors.\n' > "$vault/Movies/Arrival.md"
printf 'Not a movie.\n' > "$vault/Other.md"
cp "$root/main.js" "$root/manifest.json" "$root/styles.css" "$vault/.obsidian/plugins/custom-views/"
cp "$root/scripts/obsidian-compat/test-vault-data.json" "$vault/.obsidian/plugins/custom-views/data.json"
echo '["custom-views"]' > "$vault/.obsidian/community-plugins.json"

# Obsidian runs the newest obsidian-<version>.asar in its config folder over the one it ships with.
if [[ "$asar" == *.gz ]]; then gunzip -c "$asar" > "$config/obsidian/obsidian-$version.asar"
else cp "$asar" "$config/obsidian/obsidian-$version.asar"; fi
cat > "$config/obsidian/obsidian.json" <<JSON
{"vaults":{"e2e0000000000000":{"path":"$vault","ts":$(date +%s)000,"open":true}}}
JSON

cd "$work"
chmod +x "$appimage"
"$appimage" --appimage-extract >/dev/null
export XDG_CONFIG_HOME="$config"
xvfb-run -a -s "-screen 0 1440x900x24" ./squashfs-root/obsidian --no-sandbox --disable-gpu --remote-debugging-port=9222 > "$work/obsidian.log" 2>&1 &
echo $! > "$work/obsidian.pid"
echo "Obsidian $version started; log at $work/obsidian.log"
