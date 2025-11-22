const hre = require("hardhat");
const addresses = require('../tmp-contract-addresses.json');

async function main() {
  const Splitwise = await hre.ethers.getContractFactory("Splitwise");
  const splitwise = await Splitwise.attach(addresses.splitwise);

  const [owner] = await hre.ethers.getSigners();
  const tx = await splitwise.connect(owner).createGroup();
  const receipt = await tx.wait();

  const groupId = receipt.events[0].args.groupId.toNumber();
  console.log(`✔️  Group created with ID: ${groupId}`);
}

main().catch(console.error);
