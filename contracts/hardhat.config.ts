import "@nomicfoundation/hardhat-toolbox";
import "@openzeppelin/hardhat-upgrades";
import "hardhat-dependency-compiler";
import "hardhat-deploy";

import "dotenv/config";

export default {
  solidity: {
    compilers: [
      {
        version: "0.8.10",
        settings: {
          optimizer: { enabled: true, runs: 100_000 },
          evmVersion: "berlin",
        },
      },
      {
        version: "0.8.12",
        settings: {
          optimizer: { enabled: true, runs: 100_000 },
          evmVersion: "berlin",
        },
      },
      {
        version: "0.8.28",
        settings: {
          optimizer: { enabled: true, runs: 100_000 },
        },
      },
    ],
  },
  networks: {
      hardhat: {
        chainId: 1337,
        default: true,
        allowBlocksWithSameTimestamp: true,
      },
    tac_turin: {
      url: "https://newyork-inap-72-251-230-233.ankr.com/tac_tacd_testnet_full_rpc_1",
      chainId: 2390,
      accounts: [process.env.PRIVATE_KEY || ""],
      saveDeployments: true,
    },
  },
  namedAccounts: {
    deployer: {
      default: 0,
    },
  },
  etherscan: {
    customChains: [
      {
        network: "tac_turin",
        chainId: 2390,
        urls: {
            apiURL: "",
            browserURL: "https://explorer.tac-turin.ankr.com/",
        },
      },
    ],
  },
  dependencyCompiler: {
    paths: [
      "@zerolendxyz/core-v3/contracts/dependencies/openzeppelin/upgradeability/InitializableAdminUpgradeabilityProxy.sol",
    ],
  },
  typechain: {
    outDir: "typechain",
    target: "ethers-v6",
  },
};