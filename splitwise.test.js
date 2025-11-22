const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("TRUST Splitwise", function () {
  let token, splitwise, owner, alice, bob, carol;

  beforeEach(async () => {
    [owner, alice, bob, carol] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("TrustToken");
    token = await Token.deploy(1);
    await token.deployed();

    for (const u of [alice, bob, carol]) {
      await token.connect(u).mint({ value: 100 });
      await token.connect(u).approve(owner.address, 100);
    }

    const Splitwise = await ethers.getContractFactory("Splitwise");
    splitwise = await Splitwise.deploy(token.address);
    await splitwise.deployed();

    for (const u of [alice, bob, carol]) {
      await token.connect(u).approve(splitwise.address, 100);
    }
  });

  it("lets users create and join a group", async () => {
    await splitwise.createGroup([alice.address, bob.address]);
    expect(await splitwise.groupCount()).to.equal(1);
    await splitwise.connect(carol).joinGroup(0);
  });

  it("registers an equal expense correctly", async () => {
    await splitwise.createGroup([alice.address, bob.address, carol.address]);
    await splitwise.connect(alice).registerExpense(0, 3, 0, [alice.address, bob.address, carol.address], []);
    expect(await splitwise.debts(0, bob.address, alice.address)).to.equal(1);
    expect(await splitwise.debts(0, carol.address, alice.address)).to.equal(1);
  });

  it("lets users submit simplified edges off-chain", async () => {
    await splitwise.createGroup([alice.address, bob.address, carol.address]);
    const edges = [{ debtor: bob.address, creditor: carol.address, amount: 2 }];
    
    // Generate hash
    const edgesHash = ethers.utils.keccak256(
      ethers.utils.defaultAbiCoder.encode(
        ["tuple(address debtor, address creditor, uint256 amount)[]"],
        [edges]
      )
    );
    
    // Commit and apply
    await splitwise.connect(bob).commitSimplification(0, edgesHash);
    await splitwise.connect(bob).applySimplification(0, edges, edgesHash);
    
    expect(await splitwise.debts(0, bob.address, carol.address)).to.equal(2);
  });

  it("allows debt settlement via token transfer", async () => {
    await splitwise.createGroup([alice.address, bob.address]);
    await splitwise.connect(alice).registerExpense(0, 4, 0, [alice.address, bob.address], []);
    await splitwise.connect(bob).settleDebt(0, alice.address, 2);
    expect(await splitwise.debts(0, bob.address, alice.address)).to.equal(0);
    expect(await token.balanceOf(alice.address)).to.equal(102);
  });
});

describe("Edge Cases & Stress Tests", () => {
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

  it("rejects joining non-existent group", async () => {
    await expect(splitwise.connect(users[1]).joinGroup(99)).to.be.revertedWith("Group not found");
  });

  it("rejects re-joining a group twice", async () => {
    await splitwise.createGroup([users[0].address, users[1].address]);
    await splitwise.connect(users[2]).joinGroup(0);
    await expect(splitwise.connect(users[2]).joinGroup(0)).to.be.revertedWith("Already joined");
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

  it("rejects settlement > debt", async () => {
    await splitwise.createGroup([users[0].address, users[1].address]);
    await splitwise.connect(users[0]).registerExpense(0, 4, 0, [users[0].address, users[1].address], []);
    await expect(
      splitwise.connect(users[1]).settleDebt(0, users[0].address, 5)
    ).to.be.revertedWith("Exceeds debt");
  });

  it("rejects settlement by non-member", async () => {
    await splitwise.createGroup([users[0].address, users[1].address]);
    await expect(
      splitwise.connect(users[2]).settleDebt(0, users[0].address, 1)
    ).to.be.revertedWith("Not a group member");
  });

  it("rejects commitSimplification with non-member caller", async () => {
    await splitwise.createGroup([users[0].address, users[1].address]);
    const edges = [{ debtor: users[0].address, creditor: users[1].address, amount: 1 }];
    const edgesHash = ethers.utils.keccak256(
      ethers.utils.defaultAbiCoder.encode(
        ["tuple(address debtor, address creditor, uint256 amount)[]"],
        [edges]
      )
    );
    await expect(
      splitwise.connect(users[2]).commitSimplification(0, edgesHash)
    ).to.be.revertedWith("Not a group member");
  });

  it("rejects applySimplification with non-member caller", async () => {
    await splitwise.createGroup([users[0].address, users[1].address]);
    const edges = [{ debtor: users[0].address, creditor: users[1].address, amount: 1 }];
    const edgesHash = ethers.utils.keccak256(
      ethers.utils.defaultAbiCoder.encode(
        ["tuple(address debtor, address creditor, uint256 amount)[]"],
        [edges]
      )
    );
    await splitwise.connect(users[0]).commitSimplification(0, edgesHash);
    await expect(
      splitwise.connect(users[2]).applySimplification(0, edges, edgesHash)
    ).to.be.revertedWith("Not a group member");
  });

  it("rejects mint with zero ETH", async () => {
    await expect(token.mint({ value: 0 })).to.be.revertedWith("Send ETH to mint");
  });
  
  it("requires allowance before settlement", async () => {
    const [alice, bob] = users;
    await splitwise.createGroup([alice.address, bob.address]);
    await splitwise.connect(alice).registerExpense(0, 5, 0, [alice.address, bob.address], []);
    
    // Revoke allowance
    await token.connect(bob).approve(splitwise.address, 0);
    await expect(
      splitwise.connect(bob).settleDebt(0, alice.address, 2)
    ).to.be.reverted;
    
    // Re-approve and succeed
    await token.connect(bob).approve(splitwise.address, 5);
    await splitwise.connect(bob).settleDebt(0, alice.address, 2);
  });
  

  it("handles a large group expense (n=20) within gas limits", async () => {
    const addresses = users.slice(0, 20).map(u => u.address);
    await splitwise.createGroup(addresses);
    await splitwise.connect(users[0]).registerExpense(0, 20, 0, addresses, []);
  });

  it("stress-test simplification for many edges", async () => {
    const addresses = users.slice(0, 10).map(u => u.address);
    await splitwise.createGroup(addresses);

    const edges = [];
    for (let i = 0; i < 10; i++) {
      edges.push({
        debtor: addresses[i],
        creditor: addresses[(i + 1) % 10],
        amount: i + 1
      });
    }

    const edgesHash = ethers.utils.keccak256(
      ethers.utils.defaultAbiCoder.encode(
        ["tuple(address debtor, address creditor, uint256 amount)[]"],
        [edges]
      )
    );

    // Commit and apply
    await splitwise.connect(users[0]).commitSimplification(0, edgesHash);
    await splitwise.connect(users[0]).applySimplification(0, edges, edgesHash);

    expect(await splitwise.debts(0, addresses[0], addresses[1])).to.equal(1);
  });
});