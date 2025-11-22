const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Simplification Logic", function () {
  let token, splitwise, users;

  beforeEach(async () => {
    users = await ethers.getSigners();

    // Deploy TrustToken and mint to all users
    const Token = await ethers.getContractFactory("TrustToken");
    token = await Token.deploy(1);
    await token.deployed();
    console.log("✓ Deployed TrustToken");

    for (const user of users) {
      await token.connect(user).mint({ value: 100 });
      await token.connect(user).approve(user.address, 100);
    }

    // Deploy Splitwise contract
    const Splitwise = await ethers.getContractFactory("Splitwise");
    splitwise = await Splitwise.deploy(token.address);
    await splitwise.deployed();
    console.log("✓ Deployed Splitwise");

    // Approve Splitwise to use tokens on behalf of users
    for (const user of users) {
      await token.connect(user).approve(splitwise.address, 100);
    }
  });

  it("lets users submit and apply simplification", async () => {
    console.log("\n# Creating group with 3 users (0, 1, 2)");
    await splitwise.createGroup([
      users[0].address,
      users[1].address,
      users[2].address
    ]);

    // Define simplified debt edge: user[1] owes user[2] 2 tokens
    const edges = [{
      debtor: users[1].address,
      creditor: users[2].address,
      amount: 2
    }];

    // Compute hash commitment of the simplified graph
    const edgesHash = ethers.utils.keccak256(
      ethers.utils.defaultAbiCoder.encode(
        ["tuple(address debtor, address creditor, uint256 amount)[]"],
        [edges]
      )
    );
    console.log("✓ Calculated edgesHash commitment");

    // Submit (commit) the hash first
    console.log("# User[1] commits simplification hash");
    await splitwise.connect(users[1]).commitSimplification(0, edgesHash);

    // Apply the simplification (reveals and updates debts)
    console.log("# User[1] applies simplification with full edge data");
    await splitwise.connect(users[1]).applySimplification(0, edges, edgesHash);

    // Assert that the new simplified debt has been recorded
    const updatedDebt = await splitwise.debts(0, users[1].address, users[2].address);
    expect(updatedDebt).to.equal(2);
    console.log(`✓ Simplified debt correctly applied: user[1] → user[2] = ${updatedDebt}`);
  });
  
});
