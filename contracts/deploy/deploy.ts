import { DeployFunction } from "hardhat-deploy/dist/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { InitializableAdminUpgradeabilityProxy, PoolProxy } from "../typechain";
import { save } from "../scripts/utils";
const func: DeployFunction = async function ({
    getNamedAccounts,
    deployments,
    ...hre
  }: HardhatRuntimeEnvironment) {
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();

  console.log("Deployer Address:", deployer);

  // Deployment parameters
  const settingsAddress = "0x0928d67A277891832c743F8179bf2035D0025392";
  const zerolendPoolAddress = "0x4dFa558A5bDDA4A4396B41c1EC1B02e330137CAf";

  // Deploy the ZLSmartAccount blueprint
  console.log("Deploying ZLSmartAccount blueprint...");
  const bluePrint = await deploy("SmartAccountBluePrint", {
    from: deployer,
    contract: "ZLSmartAccount",
    log: true,
  });
  console.log("SmartAccountBluePrint deployed at:", bluePrint.address);

  save(
    hre.network.name,
    "SmartAccountBluePrint",
    "ZLSmartAccount",
    bluePrint.address,
  );

  // Deploy the TonProxyApp implementation
  console.log("Deploying PoolProxy implementation...");
  const poolProxyArtifact = await deploy("PoolProxyImpl", {
    from: deployer,
    contract: "PoolProxy",
    args: [settingsAddress, zerolendPoolAddress],
    log: true,
  });
  console.log("PoolProxy Impl artifact deployed")

  save(
    hre.network.name,
    "PoolProxyImpl",
    "PoolProxyApp",
    poolProxyArtifact.address
  )

  // Deploy the proxy contract
  console.log("Deploying Proxy...");

  const proxyArtifact = await deploy("PoolProxy-Proxy", {
    from: deployer,
    contract: "InitializableAdminUpgradeabilityProxy",
    log: true,
  });
  console.log("Proxy artifact deployed) ");

  save(
    hre.network.name,
    "PoolProxy-Proxy",
    "InitializableAdminUpgradeabilityProxy",
    proxyArtifact.address
  )

  // Initialize the proxy with the TonProxyApp implementation and initializer data
  const PoolProxyImpl = (await hre.ethers.getContractAt(
      poolProxyArtifact.abi,
      poolProxyArtifact.address
  )) as any as PoolProxy;

  const proxy = (await hre.ethers.getContractAt(
    proxyArtifact.abi,
    proxyArtifact.address
  )) as any as InitializableAdminUpgradeabilityProxy;

  const tx = await PoolProxyImpl.initialize(
    bluePrint.address,
   { gasLimit: 1000000 }
  );

  await tx.wait();
  console.log("ProxyImpl initialized with TonProxyApp and ZLSmartAccount blueprint, at tx: ", tx.hash);

  const initializePayload = PoolProxyImpl.interface.encodeFunctionData(
    "initialize",
    [
        bluePrint.address,
    ]
);
  const proxyInitTx = await proxy["initialize(address,address,bytes)"](
    poolProxyArtifact.address,
    deployer,
    initializePayload
  );
  await proxyInitTx.wait();
    console.log("Proxy initialized with TonProxyApp and ZLSmartAccount blueprint, at tx: ", proxyInitTx.hash);
};

func.tags = ["TonProxyApp"];
func.dependencies = [];
func.id = "TonProxyApp";

export default func;