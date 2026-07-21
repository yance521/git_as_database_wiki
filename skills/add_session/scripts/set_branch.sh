#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
STORY_BIN=$(CDPATH= cd -- "$SCRIPT_DIR/../../../bin" && pwd)/story.js

exec "$STORY_BIN" session add-codex-branch "$1" --json
