import { groth16 } from "snarkjs";
import * as fs from "fs";
import * as path from "path";

/**
 * Proof generation utilities for testing
 */

export interface Proof {
  pi_a: string[];
  pi_b: string[][];
  pi_c: string[];
  publicSignals: string[];
  protocol: string;
  curve: string;
}

/**
 * Generate a Groth16 proof for a circuit
 */
export async function generateProof(
  wasmPath: string,
  zkeyPath: string,
  input: any
): Promise<Proof> {
  const { proof, publicSignals } = await groth16.fullProve(
    input,
    wasmPath,
    zkeyPath
  );

  return {
    pi_a: proof.pi_a,
    pi_b: proof.pi_b,
    pi_c: proof.pi_c,
    publicSignals,
    protocol: "groth16",
    curve: "bn128"
  };
}

/**
 * Verify a Groth16 proof
 */
export async function verifyProof(
  vkeyPath: string,
  proof: Proof
): Promise<boolean> {
  return await groth16.verify(
    vkeyPath,
    proof.publicSignals,
    proof
  );
}

/**
 * Load a verification key from file
 */
export function loadVerificationKey(vkeyPath: string): any {
  const vkey = JSON.parse(fs.readFileSync(vkeyPath, "utf8"));
  return vkey;
}

/**
 * Convert proof to Solidity calldata format
 */
export function proofToSolidity(proof: Proof): {
  a: [bigint, bigint];
  b: [[bigint, bigint], [bigint, bigint]];
  c: [bigint, bigint];
  input: bigint[];
} {
  return {
    a: [BigInt(proof.pi_a[0]), BigInt(proof.pi_a[1])],
    b: [
      [BigInt(proof.pi_b[0][0]), BigInt(proof.pi_b[0][1])],
      [BigInt(proof.pi_b[1][0]), BigInt(proof.pi_b[1][1])]
    ],
    c: [BigInt(proof.pi_c[0]), BigInt(proof.pi_c[1])],
    input: proof.publicSignals.map(s => BigInt(s))
  };
}

/**
 * Get paths to circuit artifacts
 */
export function getCircuitPaths(circuitName: string, buildDir: string = "./build") {
  return {
    wasm: path.join(buildDir, "wasm", `${circuitName}_js`, `${circuitName}.wasm`),
    zkey: path.join(buildDir, "keys", `${circuitName}_0.zkey`),
    vkey: path.join(buildDir, "keys", `${circuitName}_vkey.json`),
    r1cs: path.join(buildDir, "r1cs", `${circuitName}.r1cs`)
  };
}
