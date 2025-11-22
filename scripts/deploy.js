const hre = require("hardhat");
const fs = require("fs");

// Helper function to estimate gas costs
async function estimateGasCost(txPromise, description) {
    try {
        const tx = await txPromise;
        const receipt = await tx.wait();
        const gasUsed = receipt.gasUsed.toNumber();
        const gasPrice = (await tx.getGasPrice()).toNumber();
        const gasCostEth = gasUsed * gasPrice / 1e18;
        console.log(`    💸 ${description}: ${gasUsed.toLocaleString()} gas, ~${gasCostEth.toFixed(6)} ETH`);
        return { tx, receipt, gasUsed, gasCostEth };
    } catch (error) {
        console.log(`    ❌ ${description}: Failed to execute - ${error.message}`);
        throw error;
    }
}

// Helper function to verify contract deployment
async function verifyContract(address, constructorArguments = []) {
    try {
        await hre.run("verify:verify", {
            address: address,
            constructorArguments: constructorArguments,
        });
        console.log(`    ✅ Contract at ${address.substring(0, 6)}... verified`);
    } catch (error) {
        if (error.message.toLowerCase().includes("already verified")) {
            console.log(`    ✅ Contract at ${address.substring(0, 6)}... already verified`);
        } else {
            console.log(`    ⚠️  Verification failed for ${address.substring(0, 6)}...: ${error.message}`);
        }
    }
}

async function main() {
  console.log("Starting deployment...");

  // Deploy TrustToken
  console.log("\n1. Deploying TrustToken...");
  const TrustToken = await hre.ethers.getContractFactory("TrustToken");
  const rate = 1000; // 1000 tokens per ETH (reasonable rate)
  
  const deployResult = await estimateGasCost(
    TrustToken.deploy(rate),
    "Deploy TrustToken"
  );
  
  const trustToken = deployResult.tx;
  await trustToken.deployed();
  console.log(`   📦 TrustToken deployed at ${trustToken.address}`);

  // Deploy Splitwise
  console.log("\n2. Deploying Splitwise...");
  const Splitwise = await hre.ethers.getContractFactory("Splitwise");
  
  const deployResult2 = await estimateGasCost(
    Splitwise.deploy(trustToken.address),
    "Deploy Splitwise"
  );
  
  const splitwise = deployResult2.tx;
  await splitwise.deployed();
  console.log(`   📦 Splitwise deployed at ${splitwise.address}`);

  // Store addresses
  const addresses = {
    trustToken: trustToken.address,
    splitwise: splitwise.address,
    deployedAt: new Date().toISOString(),
    network: hre.network.name,
    gasPrice: (await hre.ethers.provider.getGasPrice()).toString()
  };
  
  fs.writeFileSync('tmp-contract-addresses.json', JSON.stringify(addresses, null, 2));
  console.log(`\n   💾 Addresses saved to tmp-contract-addresses.json`);

  // Verify contracts if on a network with verification
  if (hre.network.config.verificationURL) {
    console.log("\n3. Verifying contracts...");
    await verifyContract(trustToken.address, [rate]);
    await verifyContract(splitwise.address, [trustToken.address]);
  }

  // Print final deployment summary
  console.log(`\n🎉 Deployment Complete!`);
  console.log(`Network: ${hre.network.name}`);
  console.log(`TrustToken: ${trustToken.address}`);
  console.log(`Splitwise:  ${splitwise.address}`);
  console.log(`\nTotal deployment cost: ~${(deployResult.gasCostEth + deployResult2.gasCostEth).toFixed(6)} ETH`);
}

main().catch((error) => {
  console.error("❌ Deployment failed:", error);
  process.exitCode = 1;
});
