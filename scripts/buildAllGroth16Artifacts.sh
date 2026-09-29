#!/usr/bin/env bash
set -euo pipefail

# Regenerates the complete real Groth16 pipeline for every proof-bearing
# canonical History-hiding circuit. All output is kept under circuits/build.
ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT_DIR"

build_circuit() {
    local circuit="$1"
    local input="$2"
    bash ./scripts/build.sh -c "$circuit" -i "$input"
}

build_circuit identity input.json
build_circuit state state_input.json
build_circuit slashing slashing_input.json
build_circuit rating rating_input.json
build_circuit reward reward_input.json

echo "All Groth16 artifacts were generated under circuits/build/artifacts/."
