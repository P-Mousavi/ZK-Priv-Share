const { expect } = require("chai");
const { ethers } = require("hardhat");
const { buildPoseidon } = require("circomlibjs");
const {
    IncrementalMerkleTree
} = require("@zk-kit/incremental-merkle-tree");

describe("Incremental Merkle Tree Compatibility", function () {

    let solidityTree;
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
        // 3. Deploy wrapper
        //    linked with IncrementalBinaryTree
        //
        const Wrapper =
            await ethers.getContractFactory(
                "IncrementalTreeWrapper",
                {
                    libraries: {
                        IncrementalBinaryTree:
                            await incrementalBinaryTree.getAddress()
                    }
                }
            );


        solidityTree =
            await Wrapper.deploy(DEPTH);

        await solidityTree.waitForDeployment();


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
            0,
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

            await solidityTree.insert(leaf);

            jsTree.insert(leaf);


            const solidityRoot =
                await solidityTree.getRoot();

            const jsRoot =
                jsTree.root;


            expect(
                solidityRoot.toString()
            ).to.equal(
                jsRoot.toString()
            );
        }
    });
});
