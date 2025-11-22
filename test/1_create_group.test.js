// File: test/group.test.js
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Group Operations", function () {
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

  it("rejects group creation with <2 members", async () => {
    await expect(splitwise.createGroup([users[0].address])).to.be.revertedWith("Need >= 2 members");
  });

  it("lets users create and join a group", async () => {
    await splitwise.createGroup([users[1].address, users[2].address]);
    expect(await splitwise.groupCount()).to.equal(1);
    await splitwise.connect(users[3]).joinGroup(0);
  });

  it("rejects joining non-existent group", async () => {
    await expect(splitwise.connect(users[1]).joinGroup(99)).to.be.revertedWith("Group not found");
  });

  it("rejects re-joining a group twice", async () => {
    await splitwise.createGroup([users[0].address, users[1].address]);
    await splitwise.connect(users[2]).joinGroup(0);
    await expect(splitwise.connect(users[2]).joinGroup(0)).to.be.revertedWith("Already joined");
  });
});