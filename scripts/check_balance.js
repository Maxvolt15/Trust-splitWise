const hre = require("hardhat");
const addresses = require('../tmp-contract-addresses.json');
console.log("\n==================== Balance State ====================");
async function main() {
  const TrustToken = await hre.ethers.getContractFactory("TrustToken");
  const trustToken = await TrustToken.attach(addresses.trustToken);

  const [owner, alice, bob] = await hre.ethers.getSigners();

  for (const user of [owner, alice, bob]) {
    const balance = await trustToken.balanceOf(user.address);
    console.log(`${user.address} → ${hre.ethers.utils.formatEther(balance)} TT`);
  }
  console.log("=======================================================");
}

main().catch(console.error);
