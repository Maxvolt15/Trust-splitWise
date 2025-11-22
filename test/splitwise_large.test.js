"use strict";
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Splitwise Large-Group & Join Flow Refactor", function () {
  let token, splitwise;
  let signers, addresses;

  before(async () => {
    signers = await ethers.getSigners();
    addresses = signers.map(s => s.address);
    console.log(`Running tests with ${addresses.length} signers`);
  });

  beforeEach(async () => {
    // Deploy TrustToken and mint for all signers
    const Token = await ethers.getContractFactory("TrustToken");
    token = await Token.deploy(1);
    await token.deployed();

    await Promise.all(
      signers.map(u =>
        token.connect(u).mint({ value: ethers.utils.parseEther("0.001") })
          .then(() => token.connect(u).approve(token.address, ethers.constants.MaxUint256))
      )
    );

    // Deploy Splitwise
    const Splitwise = await ethers.getContractFactory("Splitwise");
    splitwise = await Splitwise.deploy(token.address);
    await splitwise.deployed();

    // Approve Splitwise to transfer tokens
    await Promise.all(
      signers.map(u =>
        token.connect(u).approve(splitwise.address, ethers.constants.MaxUint256)
      )
    );
  });

  context("Group creation and duplicate prevention", () => {
    it("should allow creating groups and prevent duplicate joins", async () => {
      // Create a group with all signers
      await splitwise.createGroup(addresses);
      expect(await splitwise.groupCount()).to.equal(1);
      console.log("Group 0 created with all signers");

      // Create another group with the same list
      await splitwise.createGroup(addresses);
      expect(await splitwise.groupCount()).to.equal(2);
      console.log("Group 1 created despite same members list");

      // Attempt to re-join an existing group
      await expect(
        splitwise.connect(signers[0]).joinGroup(0)
      ).to.be.revertedWith("Already joined");
      console.log("Duplicate join correctly reverted for group 0");
    });
  });

  context("Large group expense registration", () => {
    const GROUP_SIZE = 30;

    beforeEach(async function () {
      if (signers.length < GROUP_SIZE) {
        this.skip();
      }
      // Use first GROUP_SIZE addresses
      const groupAddrs = addresses.slice(0, GROUP_SIZE);
      await splitwise.createGroup(groupAddrs);
      console.log(`Group created with ${GROUP_SIZE} members`);
    });

    it("should split expense equally without gas issues", async () => {
      const amount = ethers.utils.parseEther("0.03");
      const groupAddrs = addresses.slice(0, GROUP_SIZE);

      // Register an equal expense by signer[0]
      await splitwise.connect(signers[0]).registerExpense(
        0,
        amount,
        0,
        groupAddrs,
        []
      );

      const expectedShare = amount.div(GROUP_SIZE);
      const debtor = groupAddrs[1];
      const creditor = groupAddrs[0];
      const owed = await splitwise.debts(0, debtor, creditor);
      expect(owed).to.equal(expectedShare);
      console.log(`Each member owes ${expectedShare.toString()} wei-equivalent TRST`);
    });
  });

  context("Partial joins and member ordering", () => {
    const INITIAL = 5;
    const NEW_MEMBERS = 5;

    beforeEach(async () => {
      const initial = addresses.slice(0, INITIAL);
      await splitwise.createGroup(initial);
      console.log(`Group initialized with ${INITIAL} members`);

      // Join additional NEW_MEMBERS
      for (let i = INITIAL; i < INITIAL + NEW_MEMBERS; i++) {
        await splitwise.connect(signers[i]).joinGroup(0);
        console.log(`signer[${i}] joined`);
      }
    });

    it("should preserve join order and prevent duplicates", async () => {
      const members = await splitwise.getMembers(0);
      const expected = addresses.slice(0, INITIAL + NEW_MEMBERS);

      expect(members.length).to.equal(expected.length);
      expect(members).to.deep.equal(expected);
      console.log("All members present in correct order");

      // Duplicate join should revert
      await expect(
        splitwise.connect(signers[INITIAL + 2]).joinGroup(0)
      ).to.be.revertedWith("Already joined");
      console.log("Duplicate join prevented for existing member");
    });
  });
});
