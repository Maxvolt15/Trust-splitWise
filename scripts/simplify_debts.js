const hre = require("hardhat");
const { ethers } = require("hardhat");
const fs = require('fs');

// Helper function to convert to the format used in the contract (18 decimals)
const toWei = (n) => ethers.utils.parseEther(n.toString());
// Helper function to convert from the contract's format to a readable number
const fromWei = (n) => parseFloat(ethers.utils.formatEther(n));

// Helper function to print the current debt state
async function checkDebts(splitwise, users, message) {
    console.log(`\n--- Debt Check: ${message} ---`);
    let hasDebts = false;
    for (const debtor of users) {
        for (const creditor of users) {
            if (debtor.address === creditor.address) continue;
            const debtAmount = await splitwise.debts(0, debtor.address, creditor.address);
            if (debtAmount.gt(0)) {
                console.log(`  - ${debtor.address.substring(0, 6)}... owes ${creditor.address.substring(0, 6)}... -> ${fromWei(debtAmount)} TRST`);
                hasDebts = true;
            }
        }
    }
    if (!hasDebts) {
        console.log("  ✅ All debts in the group are settled.");
    }
    console.log("------------------------------------");
}


async function main() {
  console.log(" Starting a REAL off-chain debt simplification and settlement...");

  // --- 1. SETUP ---
  // Get the first 3 accounts from Hardhat as our users
  const [owner, alice, bob] = await hre.ethers.getSigners();
  const users = [owner, alice, bob];
  const gid = 0;

  // Load contract addresses from the file created by deploy.js
  const addresses = JSON.parse(fs.readFileSync('tmp-contract-addresses.json', 'utf8'));
  const splitwise = await hre.ethers.getContractAt("Splitwise", addresses.splitwise);
  const token = await hre.ethers.getContractAt("TrustToken", addresses.trustToken);

  // --- 2. READ CURRENT DEBTS (The Off-Chain App Reads the Blockchain) ---
  console.log("\n    #  Step 1: Reading the current complex debt graph from the contract...");
  const balances = new Map();
  for (const user of users) {
      balances.set(user.address, ethers.BigNumber.from(0));
  }

  for (const debtor of users) {
    for (const creditor of users) {
      if (debtor.address === creditor.address) continue;
      const debtAmount = await splitwise.debts(gid, debtor.address, creditor.address);
      if (debtAmount.gt(0)) {
          console.log(`       - Found debt: ${debtor.address.substring(0,6)}... owes ${creditor.address.substring(0,6)}... ${fromWei(debtAmount)} TRST`);
          // Update balances: debtor's balance goes down, creditor's goes up
          balances.set(debtor.address, balances.get(debtor.address).sub(debtAmount));
          balances.set(creditor.address, balances.get(creditor.address).add(debtAmount));
      }
    }
  }

  // --- 3. RUN THE GREEDY ALGORITHM (The Off-Chain App Computes) ---
  console.log("\n    #  Step 2: Running the greedy algorithm to find the simplest payment plan...");
  const debtors = [];
  const creditors = [];
  for (const [user, balance] of balances.entries()) {
      if (balance.lt(0)) debtors.push({ address: user, amount: balance.abs() });
      else if (balance.gt(0)) creditors.push({ address: user, amount: balance });
  }
  
  // Sort by largest amounts first
  debtors.sort((a, b) => b.amount.sub(a.amount));
  creditors.sort((a, b) => b.amount.sub(a.amount));

  const simplifiedEdges = [];
  while (debtors.length > 0 && creditors.length > 0) {
      const debtor = debtors[0];
      const creditor = creditors[0];
      const paymentAmount = debtor.amount.lt(creditor.amount) ? debtor.amount : creditor.amount;

      if (paymentAmount.gt(0)) {
        simplifiedEdges.push({ debtor: debtor.address, creditor: creditor.address, amount: paymentAmount });
      }

      debtor.amount = debtor.amount.sub(paymentAmount);
      creditor.amount = creditor.amount.sub(paymentAmount);

      if (debtor.amount.isZero()) debtors.shift();
      if (creditor.amount.isZero()) creditors.shift();
  }
  console.log("       Simplification complete!");


  // --- 4. COMMIT AND APPLY THE RESULT (The Off-Chain App Writes to the Blockchain) ---


  const encodedData = ethers.utils.defaultAbiCoder.encode(["(address debtor,address creditor,uint256 amount)[]"], [simplifiedEdges]);
  const edgesHash = ethers.utils.solidityKeccak256(["bytes"], [encodedData]);

  console.log("\n    #  Step 3: Committing the new, logical simplification to the contract...");
  await splitwise.connect(owner).commitSimplification(gid, edgesHash);

  console.log("    #  Step 4: Applying the simplification...");
  await splitwise.connect(owner).applySimplification(gid, simplifiedEdges, edgesHash);
  await checkDebts(splitwise, users, "After Simplification");

  // --- 5. PRE-SETTLEMENT: Minting EXACT tokens for debtors ---
  console.log("\n    #  Step 5: Minting the EXACT tokens needed for settlement...");
  const totalDebts = new Map();
  for(const edge of simplifiedEdges) {
      const currentDebt = totalDebts.get(edge.debtor) || ethers.BigNumber.from(0);
      totalDebts.set(edge.debtor, currentDebt.add(edge.amount));
  }

  for(const [debtorAddress, totalAmountOwed] of totalDebts.entries()) {
      const debtorSigner = await ethers.getSigner(debtorAddress);
      const currentBalance = await token.balanceOf(debtorAddress);
      if (currentBalance.lt(totalAmountOwed)) {
          const amountToMint = totalAmountOwed.sub(currentBalance);
          console.log(`       - Minting ${fromWei(amountToMint)} TRST for ${debtorSigner.address.substring(0,6)}...`);
          // Note: In a real app, the mint rate matters. Here we assume 1 wei = 1 token unit for simplicity.
          await token.connect(debtorSigner).mint({ value: amountToMint });
      }
  }

  // --- 6. SETTLEMENT PHASE ---
  console.log("\n    #  Step 6: Settling the simplified debts...");
  if (simplifiedEdges.length === 0) {
      console.log("       No debts needed to be settled!");
  } else {
    for (const edge of simplifiedEdges) {
        const debtorSigner = await ethers.getSigner(edge.debtor);
        console.log(`       - ${debtorSigner.address.substring(0,6)}... is paying ${edge.creditor.substring(0,6)}... ${fromWei(edge.amount)} TRST`);
        
        await token.connect(debtorSigner).approve(splitwise.address, edge.amount);
        await splitwise.connect(debtorSigner).settleDebt(gid, edge.creditor, edge.amount);
    }
  }
  
  // --- 7. FINAL VERIFICATION ---
  await checkDebts(splitwise, users, "Final State");
  
  console.log("\n✔️  Full scenario complete. All debts are settled.");
}

main().catch((error) => {
  console.error("❌ Error:", error);
  process.exitCode = 1;
});