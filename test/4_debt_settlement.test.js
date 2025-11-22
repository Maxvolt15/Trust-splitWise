const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Debt Settlement", function () {
  let token, splitwise, users;

  beforeEach(async () => {
    users = await ethers.getSigners();

    // Deploy token and mint to users
    const Token = await ethers.getContractFactory("TrustToken");
    token = await Token.deploy(1);
    await token.deployed();
    console.log("✓ Deployed TrustToken");

    for (const user of users) {
      await token.connect(user).mint({ value: 100 });
      await token.connect(user).approve(user.address, 100);
    }

    // Deploy Splitwise and approve spending
    const Splitwise = await ethers.getContractFactory("Splitwise");
    splitwise = await Splitwise.deploy(token.address);
    await splitwise.deployed();
    console.log("✓ Deployed Splitwise");

    for (const user of users) {
      await token.connect(user).approve(splitwise.address, 100);
    }
  });

  it("allows debt settlement via token transfer", async () => {
    console.log("\n#  Create group between users[0] (payer) and users[1]");
    await splitwise.createGroup([users[0].address, users[1].address]);

    console.log("#  users[0] registers expense of 4 tokens (equal split)");
    await splitwise.connect(users[0]).registerExpense(0, 4, 0, [users[0].address, users[1].address], []);

    console.log("#  users[1] settles 2 tokens of debt to users[0]");
    await splitwise.connect(users[1]).settleDebt(0, users[0].address, 2);

    console.log("✓ Debt should now be reduced or cleared");
    expect(await splitwise.debts(0, users[1].address, users[0].address)).to.equal(0);
  });

  it("rejects settlement > debt", async () => {
    console.log("\n#  Setup: users[0] creates group and logs 4-token expense");
    await splitwise.createGroup([users[0].address, users[1].address]);
    await splitwise.connect(users[0]).registerExpense(0, 4, 0, [users[0].address, users[1].address], []);

    console.log("#  users[1] tries to overpay 5 tokens");
    await expect(
      splitwise.connect(users[1]).settleDebt(0, users[0].address, 5)
    ).to.be.revertedWith("Exceeds debt");
    console.log("✓ Revert on overpayment as expected");
  });

  it("requires allowance before settlement", async () => {
    console.log("\n#  Setup: users[0] logs expense where users[1] owes 2+ tokens");
    await splitwise.createGroup([users[0].address, users[1].address]);
    await splitwise.connect(users[0]).registerExpense(0, 5, 0, [users[0].address, users[1].address], []);

    console.log("#  Revoke spender approval for Splitwise");
    await token.connect(users[1]).approve(splitwise.address, 0);

    console.log("#  Attempting settlement with 0 allowance (should fail)");
    await expect(
      splitwise.connect(users[1]).settleDebt(0, users[0].address, 2)
    ).to.be.reverted;

    console.log("#  Re-approving tokens to Splitwise");
    await token.connect(users[1]).approve(splitwise.address, 5);

    console.log("#  Trying settlement again");
    await splitwise.connect(users[1]).settleDebt(0, users[0].address, 2);

    console.log("✓ Settlement succeeded after restoring allowance");
  });
});
