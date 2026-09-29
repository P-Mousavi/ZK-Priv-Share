#!/usr/bin/env bash
set -e

# Help function
show_help() {
    cat << EOF
Usage: $0 -c CIRCUIT_NAME -i INPUT_JSON

Build a Circom circuit with Groth16 proof generation.

Options:
    -c CIRCUIT_NAME    Name of the circuit (without .circom extension)
    -i INPUT_JSON      Path to the input JSON file
    -h                 Show this help message

Example:
    $0 -c merkleProof -i input.json
EOF
    exit 0
}

# Parse command line arguments
CIRCUIT=""
INPUT_JSON=""

while getopts "c:i:h" opt; do
    case $opt in
        c)
            CIRCUIT="$OPTARG"
            ;;
        i)
            INPUT_JSON="$OPTARG"
            ;;
        h)
            show_help
            ;;
        \?)
            echo "Invalid option: -$OPTARG" >&2
            show_help
            ;;
    esac
done

# Check if required arguments are provided
if [ -z "$CIRCUIT" ] || [ -z "$INPUT_JSON" ]; then
    echo "Error: Both -c and -i arguments are required." >&2
    echo ""
    show_help
fi

CWD=$(dirname "${BASH_SOURCE[0]}")/../circuits
cd $CWD

# The npm dependency named "circom" is the obsolete 0.x compiler. These
# circuits require Circom 2.2.3, which is installed separately in this PoC.
# Allow portable callers to override the binary, while keeping npm's PATH from
# silently selecting the incompatible package executable.
CIRCOM_BIN="${CIRCOM_BIN:-/home/spm/.cargo/bin/circom}"
test -x "$CIRCOM_BIN" || {
    echo "Circom 2 compiler not found at $CIRCOM_BIN; set CIRCOM_BIN to a Circom 2.2.3 executable." >&2
    exit 1
}
"$CIRCOM_BIN" --version | grep -q "2\.2\.3" || {
    echo "Expected Circom 2.2.3 at $CIRCOM_BIN." >&2
    exit 1
}

echo ">>> Cleaning previous build for $CIRCUIT..."
rm -rf build/${CIRCUIT}_js build/${CIRCUIT}.r1cs build/${CIRCUIT}.sym build/${CIRCUIT}_*.zkey build/witness.wtns build/proof.json build/public.json build/verification_key.json build/artifacts/${CIRCUIT} 2>/dev/null

mkdir -p build

echo ">>> Compiling circuit..."
# IMPORTANT: add include path for circomlib, adjust if needed
"$CIRCOM_BIN" $CIRCUIT.circom --r1cs --wasm --sym -o build

echo ">>> R1CS info:"
npx snarkjs r1cs info build/$CIRCUIT.r1cs 1>/dev/null

echo ">>> Generating witness..."
node build/${CIRCUIT}_js/generate_witness.js \
    build/${CIRCUIT}_js/${CIRCUIT}.wasm $INPUT_JSON build/witness.wtns 1>/dev/null

echo ">>> Setting up Powers of Tau (ptau)..."
# state.circom currently has more than 2^14 constraints.  Use 2^15 for every
# History-hiding circuit so the generated proving keys remain valid as the
# shared stake/state constraints are enabled.
if [ ! -s build/pot15_final.ptau ]; then
    npx snarkjs powersoftau new bn128 15 build/pot15_0000.ptau -v 1>/dev/null
    printf "%s" "$(openssl rand -hex 32)" | npx snarkjs powersoftau contribute build/pot15_0000.ptau build/pot15_0001.ptau --name="first contribution" -v -e 1>/dev/null
    npx snarkjs powersoftau prepare phase2 build/pot15_0001.ptau build/pot15_final.ptau -v 1>/dev/null
else
    echo ">>> Reusing build/pot15_final.ptau"
fi

echo ">>> Groth16 setup..."
npx snarkjs groth16 setup build/$CIRCUIT.r1cs build/pot15_final.ptau build/${CIRCUIT}_0000.zkey 1>/dev/null
printf "%s" "$(openssl rand -hex 32)" | npx snarkjs zkey contribute build/${CIRCUIT}_0000.zkey build/${CIRCUIT}_final.zkey --name="key contribution" -v -e 1>/dev/null

echo ">>> Exporting verification key..."
npx snarkjs zkey export verificationkey build/${CIRCUIT}_final.zkey build/verification_key.json 1>/dev/null

echo ">>> Generating proof..."
npx snarkjs groth16 prove build/${CIRCUIT}_final.zkey build/witness.wtns build/proof.json build/public.json 1>/dev/null

echo ">>> Verifying proof..."
npx snarkjs groth16 verify build/verification_key.json build/public.json build/proof.json 1>/dev/null

# Keep each circuit's proof material separate.  The legacy generic filenames
# remain for existing scripts, while these copies prevent a state build from
# silently being consumed as a state-transition proof (or vice versa).
ARTIFACT_DIR="build/artifacts/${CIRCUIT}"
mkdir -p "$ARTIFACT_DIR"
cp "build/${CIRCUIT}.r1cs" "$ARTIFACT_DIR/${CIRCUIT}.r1cs"
cp "build/${CIRCUIT}.sym" "$ARTIFACT_DIR/${CIRCUIT}.sym"
cp "build/${CIRCUIT}_js/${CIRCUIT}.wasm" "$ARTIFACT_DIR/${CIRCUIT}.wasm"
cp "build/${CIRCUIT}_0000.zkey" "$ARTIFACT_DIR/${CIRCUIT}_0000.zkey"
cp "build/${CIRCUIT}_final.zkey" "$ARTIFACT_DIR/${CIRCUIT}.zkey"
cp build/verification_key.json "$ARTIFACT_DIR/verification_key.json"
cp build/witness.wtns "$ARTIFACT_DIR/witness.wtns"
cp build/proof.json "$ARTIFACT_DIR/proof.json"
cp build/public.json "$ARTIFACT_DIR/public.json"
cp "$INPUT_JSON" "$ARTIFACT_DIR/input.json"

echo ">>> Generating the verifier solidity program"
# Output to appropriate verifier file based on circuit name
if [ "$CIRCUIT" = "reward" ]; then
    VERIFIER_FILE="../contracts/RewardVerifier.sol"
elif [ "$CIRCUIT" = "state_transition" ]; then
    VERIFIER_FILE="../contracts/StateTransitionVerifier.sol"
elif [ "$CIRCUIT" = "state" ]; then
    VERIFIER_FILE="../contracts/StateVerifier.sol"
elif [ "$CIRCUIT" = "slashing" ]; then
    VERIFIER_FILE="../contracts/SlashingVerifier.sol"
elif [ "$CIRCUIT" = "rating" ]; then
    VERIFIER_FILE="../contracts/RatingVerifier.sol"
else
    VERIFIER_FILE="../contracts/Verifier.sol"
fi
npx snarkjs zkey export solidityverifier build/${CIRCUIT}_final.zkey $VERIFIER_FILE 1>/dev/null

echo ">>> Post-processing Verifier.sol to add 'virtual' keyword and fix pragma version"
# Add 'virtual' to verifyProof function to allow overriding
sed -i '/function verifyProof.*public view returns (bool)/s/public view returns/public view virtual returns/' $VERIFIER_FILE
if [ "$CIRCUIT" = "state_transition" ]; then
    sed -i 's/contract Groth16Verifier {/contract StateTransitionGroth16Verifier {/' $VERIFIER_FILE
fi
# Fix pragma version to match project (0.8.20)
sed -i 's/pragma solidity >=0.7.0 <0.9.0;/pragma solidity ^0.8.20;/' $VERIFIER_FILE

cp "$VERIFIER_FILE" "$ARTIFACT_DIR/$(basename "$VERIFIER_FILE")"
for artifact in \
    "$ARTIFACT_DIR/${CIRCUIT}.r1cs" \
    "$ARTIFACT_DIR/${CIRCUIT}.sym" \
    "$ARTIFACT_DIR/${CIRCUIT}.wasm" \
    "$ARTIFACT_DIR/${CIRCUIT}_0000.zkey" \
    "$ARTIFACT_DIR/${CIRCUIT}.zkey" \
    "$ARTIFACT_DIR/verification_key.json" \
    "$ARTIFACT_DIR/witness.wtns" \
    "$ARTIFACT_DIR/proof.json" \
    "$ARTIFACT_DIR/public.json" \
    "$ARTIFACT_DIR/$(basename "$VERIFIER_FILE")"; do
    test -s "$artifact" || { echo "Missing generated artifact: $artifact" >&2; exit 1; }
done

echo ">>> DONE. Proof + public inputs generated."
