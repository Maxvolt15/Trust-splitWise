const hre = require("hardhat");
const { ethers } = require("hardhat");
const fs = require('fs');

// Helper function to format Ether amounts
const fromWei = (n) => parseFloat(ethers.utils.formatEther(n));

async function main() {
  console.log("🔍 Checking the internal debt graph...");

  // Load contract addresses from the temporary file
  const addresses = JSON.parse(fs.readFileSync('tmp-contract-addresses.json', 'utf8'));
  
  // Get contract instances
  const splitwise = await hre.ethers.getContractAt("Splitwise", addresses.splitwise);
  
  // Get user accounts
  const [user1, user2, user3] = await ethers.getSigners();
  const users = [user1, user2, user3];
  const gid = 0; // Assuming we are checking group 0

  console.log("\n==================== Debt State ====================");
  let hasDebts = false;

  // Loop through every possible pair of users to check for debts
  for (const debtor of users) {
    for (const creditor of users) {
      if (debtor.address === creditor.address) continue; // Skip self-debt

      const debtAmount = await splitwise.debts(gid, debtor.address, creditor.address);
      
      if (debtAmount.gt(0)) { // gt(0) means "greater than 0"
        console.log(`  - User ${debtor.address.substring(0, 6)}... owes User ${creditor.address.substring(0, 6)}... -> ${fromWei(debtAmount)} TRST`);
        hasDebts = true;
      }
    }
  }

  if (!hasDebts) {
    console.log("  No outstanding debts found in the group.");
  }
  console.log("==================================================\n");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});