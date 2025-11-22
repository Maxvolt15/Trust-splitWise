// File: test/full_integration.test.js
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("TRUST Splitwise – Full Integration", function () {
  let token, splitwise;
  let alice, bob, charlie, dave;

  const toWei = n => ethers.utils.parseEther(n.toString());

  beforeEach(async () => {
    [alice, bob, charlie, dave] = await ethers.getSigners();

    console.log("\n🔧 Deploying TrustToken (1 ETH → 1 TRST) and minting 10 TRST each");
    const Token = await ethers.getContractFactory("TrustToken");
    token = await Token.deploy(toWei("1"));
    await token.deployed();
    for (const u of [alice, bob, charlie, dave]) {
      await token.connect(u).mint({ value: toWei("10") });
    }

    console.log("🔧 Deploying Splitwise and approving allowances");
    const Splitwise = await ethers.getContractFactory("Splitwise");
    splitwise = await Splitwise.deploy(token.address);
    await splitwise.deployed();
    for (const u of [alice, bob, charlie, dave]) {
      await token.connect(u).approve(splitwise.address, ethers.constants.MaxUint256);
    }
  });

  it("Weekend Trip scenario: two equal‑split expenses + off‑chain simplification", async () => {
    console.log("\n🏝️  Weekend Trip: Alice, Bob, Charlie & Dave form group #0");
    await splitwise.connect(alice).createGroup([alice.address, bob.address, charlie.address, dave.address]);
    const gid = 0;

    console.log("🍽️  Dinner: Alice pays 60 TRST → Bob, Charlie & Dave each owe 15 to Alice");
    await splitwise.connect(alice).registerExpense(
      gid, toWei("60"), 0,
      [alice.address, bob.address, charlie.address, dave.address], []
    );
    console.log("   #  debts( Bob→Alice ) =", (await splitwise.debts(gid, bob.address, alice.address)).toString() / 1e18);
    console.log("   #  debts( Charlie→Alice ) =", (await splitwise.debts(gid, charlie.address, alice.address)).toString() / 1e18);
    console.log("   #  debts( Dave→Alice ) =", (await splitwise.debts(gid, dave.address, alice.address)).toString() / 1e18);
    expect(await splitwise.debts(gid, bob.address, alice.address)).to.equal(toWei("15"));
    expect(await splitwise.debts(gid, charlie.address, alice.address)).to.equal(toWei("15"));
    expect(await splitwise.debts(gid, dave.address, alice.address)).to.equal(toWei("15"));

    console.log("🎭  Theater: Bob pays 60 TRST → Alice, Charlie & Dave each owe 15 to Bob");
    await splitwise.connect(bob).registerExpense(
      gid, toWei("60"), 0,
      [alice.address, bob.address, charlie.address, dave.address], []
    );
    console.log("   #  debts( Alice→Bob ) =", (await splitwise.debts(gid, alice.address, bob.address)).toString() / 1e18);
    console.log("   #  debts( Charlie→Bob ) =", (await splitwise.debts(gid, charlie.address, bob.address)).toString() / 1e18);
    console.log("   #  debts( Dave→Bob ) =", (await splitwise.debts(gid, dave.address, bob.address)).toString() / 1e18);
    expect(await splitwise.debts(gid, alice.address, bob.address)).to.equal(toWei("15"));
    expect(await splitwise.debts(gid, charlie.address, bob.address)).to.equal(toWei("15"));
    expect(await splitwise.debts(gid, dave.address, bob.address)).to.equal(toWei("15"));

    console.log("🧮  Off‑chain simplify: Charlie & Dave pay Alice and Bob directly");
    const edges = [
      { debtor: charlie.address, creditor: alice.address, amount: toWei("15") },
      { debtor: charlie.address, creditor: bob.address,   amount: toWei("15") },
      { debtor: dave.address, creditor: alice.address, amount: toWei("15") },
      { debtor: dave.address, creditor: bob.address,   amount: toWei("15") },
    ];
    const edgesHash = ethers.utils.keccak256(
      ethers.utils.defaultAbiCoder.encode(
        ["tuple(address debtor,address creditor,uint256 amount)[]"],
        [edges]
      )
    );
    await splitwise.connect(alice).commitSimplification(gid, edgesHash);
    await splitwise.connect(alice).applySimplification(gid, edges, edgesHash);

    console.log("   #  Post‑simplification debts:");
    console.log("      Charlie→Alice =", (await splitwise.debts(gid, charlie.address, alice.address)).toString() / 1e18);
    console.log("      Charlie→Bob   =", (await splitwise.debts(gid, charlie.address, bob.address)).toString() / 1e18);
    console.log("      Dave→Alice    =", (await splitwise.debts(gid, dave.address, alice.address)).toString() / 1e18);
    console.log("      Dave→Bob      =", (await splitwise.debts(gid, dave.address, bob.address)).toString() / 1e18);
    console.log("      Bob→Alice     =", (await splitwise.debts(gid, bob.address, alice.address)).toString() / 1e18);
    console.log("      Alice→Bob     =", (await splitwise.debts(gid, alice.address, bob.address)).toString() / 1e18);

    expect(await splitwise.debts(gid, charlie.address, alice.address)).to.equal(toWei("15"));
    expect(await splitwise.debts(gid, charlie.address, bob.address)).to.equal(toWei("15"));
    expect(await splitwise.debts(gid, dave.address, alice.address)).to.equal(toWei("15"));
    expect(await splitwise.debts(gid, dave.address, bob.address)).to.equal(toWei("15"));
    expect(await splitwise.debts(gid, bob.address, alice.address)).to.equal(toWei("0"));
    expect(await splitwise.debts(gid, alice.address, bob.address)).to.equal(toWei("0"));
  });
});
