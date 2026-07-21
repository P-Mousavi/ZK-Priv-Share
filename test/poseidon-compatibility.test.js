const { expect } = require("chai");
const { ethers } = require("hardhat");
const { buildPoseidon } = require("circomlibjs");

describe("Poseidon Compatibility", function () {
    let poseidon;
    let wrapper;

    before(async function () {
        poseidon = await buildPoseidon();

        const Wrapper = await ethers.getContractFactory(
            "PoseidonWrapper"
        );

        wrapper = await Wrapper.deploy();

        await wrapper.waitForDeployment();
    });


    async function compare(left, right) {
        const jsHash = poseidon.F.toString(
            poseidon([BigInt(left), BigInt(right)])
        );

        const solidityHash = (
            await wrapper.hash(left, right)
        ).toString();

        expect(solidityHash).to.equal(jsHash);
    }


    it("matches zero", async function () {
        await compare(0, 0);
    });

    it("matches small values", async function () {
        await compare(1, 2);
        await compare(5, 7);
        await compare(123, 456);
    });

    it("matches random values", async function () {
    for (let i = 0; i < 20; i++) {
        const left = BigInt(
            ethers.hexlify(ethers.randomBytes(30))
        );

        const right = BigInt(
            ethers.hexlify(ethers.randomBytes(30))
        );

        await compare(left, right);
    }
    });

    it("matches merkle parent calculation", async function () {
    const left = 12345n;
    const right = 67890n;

    const jsParent = poseidon.F.toString(
        poseidon([left, right])
    );

    const solidityParent = (
        await wrapper.hash(left, right)
    ).toString();

    expect(solidityParent).to.equal(jsParent);
    });
});
