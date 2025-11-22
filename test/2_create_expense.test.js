const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Expense Management", function () {
  let token, splitwise, users;

  beforeEach(async () => {
    users = await ethers.getSigners();
    const Token = await ethers.getContractFactory("TrustToken");
    token = await Token.deploy(1);
    await token.deployed();

    for (const user of users) {
      await token.connect(user).mint({ value: 100 });
      await token.connect(user).approve(user.address, 100);
    }

    const Splitwise = await ethers.getContractFactory("Splitwise");
    splitwise = await Splitwise.deploy(token.address);
    await splitwise.deployed();

    for (const user of users) {
      await token.connect(user).approve(splitwise.address, 100);
    }
  });

  it("registers an equal expense correctly", async () => {
    await splitwise.createGroup([users[0].address, users[1].address, users[2].address]);
    await splitwise.connect(users[0]).registerExpense(0, 3, 0, [users[0].address, users[1].address, users[2].address], []);
    expect(await splitwise.debts(0, users[1].address, users[0].address)).to.equal(1);
    expect(await splitwise.debts(0, users[2].address, users[0].address)).to.equal(1);
  });

  it("rejects exact split when sums mismatch", async () => {
    await splitwise.createGroup([users[0].address, users[1].address]);
    await expect(
      splitwise.connect(users[0]).registerExpense(0, 10, 1, [users[0].address, users[1].address], [4, 3])
    ).to.be.revertedWith("Sum != amount");
  });

  it("rejects expense by non-member", async () => {
    await splitwise.createGroup([users[0].address, users[1].address]);
    await expect(
      splitwise.connect(users[2]).registerExpense(0, 5, 0, [users[0].address, users[1].address], [])
    ).to.be.revertedWith("Not a group member");

  });
  
});