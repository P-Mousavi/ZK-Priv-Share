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

echo ">>> Cleaning previous build for $CIRCUIT..."
rm -rf build/${CIRCUIT}_js build/${CIRCUIT}.r1cs build/${CIRCUIT}.sym build/${CIRCUIT}_*.zkey build/witness.wtns build/proof.json build/public.json build/verification_key.json 2>/dev/null

mkdir -p build

echo ">>> Compiling circuit..."
# IMPORTANT: add include path for circomlib, adjust if needed
circom $CIRCUIT.circom --r1cs --wasm --sym -o build

echo ">>> R1CS info:"
npx snarkjs r1cs info build/$CIRCUIT.r1cs

echo ">>> Generating witness..."
node build/${CIRCUIT}_js/generate_witness.js \
    build/${CIRCUIT}_js/${CIRCUIT}.wasm $INPUT_JSON build/witness.wtns

echo ">>> Setting up Powers of Tau (ptau)..."
npx snarkjs powersoftau new bn128 13 build/pot12_0000.ptau -v
printf "%s" "$(openssl rand -hex 32)" | npx snarkjs powersoftau contribute build/pot12_0000.ptau build/pot12_0001.ptau --name="first contribution" -v -e
npx snarkjs powersoftau prepare phase2 build/pot12_0001.ptau build/pot12_final.ptau -v

echo ">>> Groth16 setup..."
npx snarkjs groth16 setup build/$CIRCUIT.r1cs build/pot12_final.ptau build/${CIRCUIT}_0000.zkey
printf "%s" "$(openssl rand -hex 32)" | npx snarkjs zkey contribute build/${CIRCUIT}_0000.zkey build/${CIRCUIT}_final.zkey --name="key contribution" -v -e

echo ">>> Exporting verification key..."
npx snarkjs zkey export verificationkey build/${CIRCUIT}_final.zkey build/verification_key.json

echo ">>> Generating proof..."
npx snarkjs groth16 prove build/${CIRCUIT}_final.zkey build/witness.wtns build/proof.json build/public.json 

echo ">>> Verifying proof..."
npx snarkjs groth16 verify build/verification_key.json build/public.json build/proof.json

echo ">>> Generating the verifier solidity program"
# Output to appropriate verifier file based on circuit name
if [ "$CIRCUIT" = "reward" ]; then
    VERIFIER_FILE="../contracts/RewardVerifier.sol"
else
    VERIFIER_FILE="../contracts/Verifier.sol"
fi
npx snarkjs zkey export solidityverifier build/${CIRCUIT}_final.zkey $VERIFIER_FILE

echo ">>> Post-processing Verifier.sol to add 'virtual' keyword and fix pragma version"
# Add 'virtual' to verifyProof function to allow overriding
sed -i '/function verifyProof.*public view returns (bool)/s/public view returns/public view virtual returns/' $VERIFIER_FILE
# Fix pragma version to match project (0.8.20)
sed -i 's/pragma solidity >=0.7.0 <0.9.0;/pragma solidity ^0.8.20;/' $VERIFIER_FILE

echo ">>> DONE. Proof + public inputs generated."
