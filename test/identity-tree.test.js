const { expect } = require("chai");
const { ethers } = require("hardhat");
const { buildPoseidon } = require("circomlibjs");
const {
    IncrementalMerkleTree
} = require("@zk-kit/incremental-merkle-tree");

describe("IdentityTree Compatibility", function () {

    let identityTree;
    let jsTree;

    const DEPTH = 20;

    before(async function () {

        poseidon = await buildPoseidon();

        //
        // 1. Deploy PoseidonT3
        //
        const PoseidonT3 =
            await ethers.getContractFactory(
                "poseidon-solidity/PoseidonT3.sol:PoseidonT3"
            );

        const poseidonT3 =
            await PoseidonT3.deploy();

        await poseidonT3.waitForDeployment();


        //
        // 2. Deploy IncrementalBinaryTree
        //    linked with PoseidonT3
        //
        const IncrementalBinaryTree =
            await ethers.getContractFactory(
                "@zk-kit/incremental-merkle-tree.sol/IncrementalBinaryTree.sol:IncrementalBinaryTree",
                {
                    libraries: {
                        PoseidonT3:
                            await poseidonT3.getAddress()
                    }
                }
            );


        const incrementalBinaryTree =
            await IncrementalBinaryTree.deploy();

        await incrementalBinaryTree.waitForDeployment();


        //
        // 3. Deploy IdentityTree
        //    linked with IncrementalBinaryTree
        //
        const IdentityTree =
            await ethers.getContractFactory(
                "IdentityTree",
                {
                    libraries: {
                        IncrementalBinaryTree:
                            await incrementalBinaryTree.getAddress()
                    }
                }
            );


        identityTree =
            await IdentityTree.deploy();

        await identityTree.waitForDeployment();


        const hash = (inputs) => {
            return BigInt(
                poseidon.F.toObject(
                    poseidon(
                        inputs.map(x => BigInt(x))
                    )
                )
            );
        };


        jsTree = new IncrementalMerkleTree(
            hash,
            DEPTH,
            BigInt(0),
            2
        );
    });


    it("matches roots after insertions", async function () {

        const leaves = [
            1n,
            2n,
            3n,
            12345n,
            99999n
        ];


        for (const leaf of leaves) {

            await identityTree.insert(leaf);

            jsTree.insert(leaf);


            const solidityRoot =
                await identityTree.getRoot();

            const jsRoot =
                jsTree.root;


            expect(
                solidityRoot.toString()
            ).to.equal(
                jsRoot.toString()
            );
        }
    });

    it("matches number of leaves", async function () {
        
        const initialCount = await identityTree.getNumberOfLeaves();
        expect(initialCount).to.equal(5); // 5 leaves inserted in previous test

        await identityTree.insert(88888n);
        jsTree.insert(88888n);

        const newCount = await identityTree.getNumberOfLeaves();
        expect(newCount).to.equal(6);
    });

    it("generates correct Merkle proof for leaf", async function () {
        
        const leafIndex = 2;
        const proof = jsTree.createProof(leafIndex);
        
        expect(proof.siblings.length).to.equal(DEPTH);
        expect(proof.pathIndices.length).to.equal(DEPTH);
    });
});
