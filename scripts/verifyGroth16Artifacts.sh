#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT_DIR"

for circuit in identity state slashing rating reward; do
    artifact_dir="circuits/build/artifacts/${circuit}"
    case "$circuit" in
        identity) verifier="Verifier.sol" ;;
        state) verifier="StateVerifier.sol" ;;
        slashing) verifier="SlashingVerifier.sol" ;;
        rating) verifier="RatingVerifier.sol" ;;
        reward) verifier="RewardVerifier.sol" ;;
    esac
    for artifact in \
        "${circuit}.r1cs" "${circuit}.sym" "${circuit}.wasm" \
        "${circuit}_0000.zkey" "${circuit}.zkey" "verification_key.json" \
        "witness.wtns" "proof.json" "public.json" "input.json" "$verifier"; do
        test -s "${artifact_dir}/${artifact}" || {
            echo "Missing ${circuit} artifact: ${artifact}" >&2
            exit 1
        }
    done
    npx snarkjs groth16 verify \
        "${artifact_dir}/verification_key.json" \
        "${artifact_dir}/public.json" \
        "${artifact_dir}/proof.json" >/dev/null
    echo "Verified ${circuit} Groth16 artifact set."
done
