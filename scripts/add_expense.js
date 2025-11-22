const hre = require("hardhat");
const { ethers } = require("hardhat");
const fs = require('fs');

const toWei = (n) => ethers.utils.parseEther(n.toString());

async function main() {
  const [owner, alice, bob] = await hre.ethers.getSigners();
  const gid = 0;

  const addresses = JSON.parse(fs.readFileSync('tmp-contract-addresses.json', 'utf8'));
  const splitwise = await hre.ethers.getContractAt("Splitwise", addresses.splitwise);
  const token = await hre.ethers.getContractAt("TrustToken", addresses.trustToken);

  // --- Invite Members ---
  console.log(`Inviting ${alice.address}`);
  await splitwise.connect(owner).inviteMember(gid, alice.address);
  console.log(`Inviting ${bob.address}`);
  await splitwise.connect(owner).inviteMember(gid, bob.address);

  // --- FIX: Have ALL users mint an initial balance ---
  console.log("\nMinting an initial 1000 TRST for all participants...");
  // Note: We use a different payer for minting vs. the expense to make the flow clearer.
  await token.connect(owner).mint({ value: toWei(1) }); // Owner starts with 1000 TRST
  await token.connect(alice).mint({ value: toWei(1) }); // Alice starts with 1000 TRST
  await token.connect(bob).mint({ value: toWei(1) });   // Bob starts with 1000 TRST

  // --- Register Expense ---
  const expenseAmount = toWei(3);
  const participants = [owner.address, alice.address, bob.address];
  
  // Alice will be the Payer for this expense. She must have enough tokens.
  // We'll have her mint more just for this expense.
  // await token.connect(alice).mint({ value: toWei(3) }); 
  
  await splitwise.connect(alice).registerExpense(gid, expenseAmount, 0, participants, []);

  console.log(`✔️  Expense registered: Alice paid 3 TRST, split equally.`);
}

main().catch((error) => {
  console.error("❌ Error:", error);
  process.exitCode = 1;
});