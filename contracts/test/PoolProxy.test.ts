
import hre, { ethers } from "hardhat";
import { deploy, TacLocalTestSdk, JettonInfo, TokenMintInfo, TokenUnlockInfo } from "tac-l2-ccl";
import { Signer, keccak256} from "ethers";
import { expect } from "chai";
import { PoolProxy } from "../typechain/contracts/proxy/PoolProxy";
import { MockPool } from "../typechain/contracts/MockPool";
import { TestToken} from "../typechain";
import { ERC20 } from "../typechain/@openzeppelin/contracts/token/ERC20";
import { ZLSmartAccount } from "../typechain/contracts/smart-accounts/ZLSmartAccount";

describe("Pool proxy test", () => {

    let admin: Signer;
    let testSdk: TacLocalTestSdk;

    let proxyContract: PoolProxy;
    let poolContract: MockPool;
    let tokenContract: TestToken;
    let smartAccountBluePrintContract: ZLSmartAccount;

    const tokenName = "TAC token";
    const tokenSymbol = "TAC";
    const tokenValue = "6400000000000000000";
    const poolBalance = "20000000000000000000000000000"

    let wTON = "";
    let wTONContract: ERC20;
    let wTON1 = "";
    let wTONContract1: ERC20;
    let crossChainLayerAddress = "";

    before(async () => {
        // setup
        [admin] = await ethers.getSigners();

        testSdk = new TacLocalTestSdk();
        crossChainLayerAddress = await testSdk.create(ethers.provider);
        
        wTON = testSdk.getEVMJettonAddress("NONE");
        wTONContract = (await ethers.getContractAt("ERC20", wTON, admin)) as ERC20;


        wTON1 = testSdk.getEVMJettonAddress("NONE1");
        wTONContract1 = (await ethers.getContractAt("ERC20", wTON1, admin)) as ERC20;

        const settingsAddress = testSdk.getSettingsAddress();

        tokenContract = await deploy<TestToken>(admin, hre.artifacts.readArtifactSync("TestToken"), [tokenName, tokenSymbol], undefined, false);
        poolContract = await deploy<MockPool>(admin, hre.artifacts.readArtifactSync("MockPool"), [ await tokenContract.getAddress(), tokenValue ], undefined, false);
        proxyContract = await deploy<PoolProxy>(admin, hre.artifacts.readArtifactSync("PoolProxy"), [await poolContract.getAddress(), settingsAddress], undefined, false);
        smartAccountBluePrintContract = await deploy<ZLSmartAccount>(admin, hre.artifacts.readArtifactSync("ZLSmartAccount"), [], undefined, false);
        
        //Initialize porxy contract
        await proxyContract.initialize( await smartAccountBluePrintContract.getAddress());
        // deposit token to treasurySwap
        await tokenContract.mint(await poolContract.getAddress(), poolBalance);

        // get tokens to admin
        await tokenContract.mint(await admin.getAddress(), "1000000000000000000000000000");
    });

    it('Check address consistency', async () => {
        expect(await proxyContract.getAppAddress()).to.be.eq(await poolContract.getAddress());
        expect(await proxyContract.getCrossChainLayerAddress()).to.be.eq(testSdk.getCrossChainLayerAddress());

        expect(await poolContract.token()).to.be.eq(await tokenContract.getAddress())
        expect(await poolContract.tokenValue()).to.be.eq(tokenValue);
    });

    it('Supply message', async () => {
        // define query id
        const queryId = 1n;
        // define operation id (it'll be created by tac infrasctaucture, but here you can define any string)
        const operationId = ethers.encodeBytes32String("test supply message");
        // define untrusted extra data by executor (it's not implemented yet on tac infrasctaucture - just empty bytes)
        const extraData = "0x";

        // define timestamp, when message was created on TVM
        const timestamp = BigInt(Math.floor(Date.now() / 1000)) + BigInt(1);

        // define tvm wallet address who sent message
        const tvmWalletCaller = "TVMCallerAddress";
        
        // define jetton token info
        const jettonInfo: JettonInfo = {
            tvmAddress: "NONE", // jetton minter contract address
            name: "TON",
            symbol: "TON",
            decimals: 9n,
        };

        // how much jetton to mint
        const tokenMintInfo: TokenMintInfo = {
            info: jettonInfo,
            mintAmount: 10n**9n,
        }

        // define target contract address
        const target = await proxyContract.getAddress();
        // define method name
        const methodName = "supply(bytes,bytes)";
        // encode arguments of proxy contract
        const encodedArguments = ethers.AbiCoder.defaultAbiCoder().encode(["tuple(address,uint256,address,uint16)"], [[wTON, tokenMintInfo.mintAmount, target, 0]]);

        // send message
        const {receipt, deployedTokens, outMessages} = await testSdk.sendMessage(
            queryId,
            target,
            methodName,
            encodedArguments,
            tvmWalletCaller,
            [tokenMintInfo],
            [],
            0n,
            extraData,
            operationId,
            timestamp
        );
        const id = keccak256(new TextEncoder().encode(tvmWalletCaller));
        const smartAccountAddress = await proxyContract.smartAccounts(id);

        expect(receipt.status).to.be.eq(1);

        // check deployed tokens
        expect(deployedTokens.length).to.be.eq(1);
        expect(deployedTokens[0].evmAddress).to.be.eq(wTON);
        expect(deployedTokens[0].tvmAddress).to.be.eq("NONE");

        // check out messages
        expect(outMessages.length).to.be.eq(0);

        // check crossChainLayer and tresaurySwap balance 
        expect(await wTONContract.balanceOf(crossChainLayerAddress)).to.be.eq(0n);
        expect(await tokenContract.balanceOf(await poolContract.getAddress())).to.be.eq(BigInt(poolBalance) - BigInt(tokenValue));
        expect(await poolContract.poolTONBalance(wTON)).to.be.eq(10n**9n);
        expect(await tokenContract.balanceOf(smartAccountAddress)).to.be.eq(tokenValue);
    });

    it('Another Supply message', async () => {
        // define query id
        const queryId = 1n;
        // define operation id (it'll be created by tac infrasctaucture, but here you can define any string)
        const operationId = ethers.encodeBytes32String("test supply message");
        // define untrusted extra data by executor (it's not implemented yet on tac infrasctaucture - just empty bytes)
        const extraData = "0x";

        // define timestamp, when message was created on TVM
        const timestamp = BigInt(Math.floor(Date.now() / 1000));

        // define tvm wallet address who sent message
        const tvmWalletCaller = "TVMCallerAddress1";
        
        // define jetton token info
        const jettonInfo: JettonInfo = {
            tvmAddress: "NONE1", // jetton minter contract address
            name: "TON1",
            symbol: "TON1",
            decimals: 9n,
        };

        // how much jetton to mint
        const tokenMintInfo: TokenMintInfo = {
            info: jettonInfo,
            mintAmount: 10n**9n,
        }

        // define target contract address
        const target = await proxyContract.getAddress();
        // define method name
        const methodName = "supply(bytes,bytes)";
        // encode arguments of proxy contract
        const encodedArguments = ethers.AbiCoder.defaultAbiCoder().encode(["tuple(address,uint256,address,uint16)"], [[wTON1, tokenMintInfo.mintAmount, target, 0]]);

        // send message
        const {receipt, deployedTokens, outMessages} = await testSdk.sendMessage(
            queryId,
            target,
            methodName,
            encodedArguments,
            tvmWalletCaller,
            [tokenMintInfo],
            [],
            0n,
            extraData,
            operationId,
            timestamp
        );
        const id = keccak256(new TextEncoder().encode(tvmWalletCaller));
        const smartAccountAddress = await proxyContract.smartAccounts(id);

        expect(receipt.status).to.be.eq(1);

        // check deployed tokens
        expect(deployedTokens.length).to.be.eq(1);
        expect(deployedTokens[0].evmAddress).to.be.eq(wTON1);
        expect(deployedTokens[0].tvmAddress).to.be.eq("NONE1");

        // check out messages
        expect(outMessages.length).to.be.eq(0);

        // check crossChainLayer and tresaurySwap balance 
        expect(await wTONContract1.balanceOf(crossChainLayerAddress)).to.be.eq(0n);
        expect(await poolContract.poolTONBalance(wTON1)).to.be.eq(10n**9n);
        expect(await tokenContract.balanceOf(smartAccountAddress)).to.be.eq(tokenValue);
        
    });

    it('Withdraw message', async () => {
        // save ton balance before
        const tonBalanceBefore = await poolContract.poolTONBalance(wTON);

        // define query id
        const queryId = 1n;
        // define operation id (it'll be created by tac infrasctaucture, but here you can define any string)
        const operationId = ethers.encodeBytes32String("test withdraw message");
        // define untrusted extra data by executor (it's not implemented yet on tac infrasctaucture - just empty bytes)
        const extraData = "0x";

        // define timestamp, when message was created on TVM
        const timestamp = BigInt(Math.floor(Date.now() / 1000));

        // define tvm wallet address who sent message
        const tvmWalletCaller = "TVMCallerAddress";

        // define target contract address
        const target = await proxyContract.getAddress();
        // define method name
        const methodName = "withdraw(bytes,bytes)";
        const withdrawAmount = 2n**18n;
        // encode arguments of proxy contract
        const encodedArguments = ethers.AbiCoder.defaultAbiCoder().encode(["tuple(address,uint256,address)"], [[wTON1, withdrawAmount, target]]);

        // send message
        const {receipt, deployedTokens, outMessages} = await testSdk.sendMessage(
            queryId,
            target,
            methodName,
            encodedArguments,
            tvmWalletCaller,
            [],
            [],
            0n,
            extraData,
            operationId,
            timestamp
        );

        expect(receipt.status).to.be.eq(1);

        // check deployed tokens
        expect(deployedTokens.length).to.be.eq(0);

        // check out messages
        expect(outMessages.length).to.be.eq(1);
        const outMessage = outMessages[0];
        expect(outMessage.queryId).to.be.eq(queryId);
        expect(outMessage.operationId).to.be.eq(operationId);
        expect(outMessage.callerAddress).to.be.eq(await proxyContract.getAddress());
        expect(outMessage.targetAddress).to.be.eq(tvmWalletCaller);
        expect(outMessage.payload).to.be.eq("");

        // check burned token
        expect(outMessage.tokensBurned.length).to.be.eq(0);

        // check locked token
        expect(outMessage.tokensLocked.length).to.be.eq(0);

        // check crossChainLayer and tresaurySwap balance
        expect(await wTONContract.balanceOf(crossChainLayerAddress)).to.be.eq(0n);
        expect(await poolContract.poolTONBalance(wTON1)).to.be.eq(tonBalanceBefore - withdrawAmount * 10n**9n / BigInt(tokenValue));
    });

    it('Borrow message', async () => {
        // save ton balance before
        const tonBalanceBefore = await poolContract.poolTONBalance(wTON);

        // define query id
        const queryId = 1n;
        // define operation id (it'll be created by tac infrasctaucture, but here you can define any string)
        const operationId = ethers.encodeBytes32String("test borrow message");
        // define untrusted extra data by executor (it's not implemented yet on tac infrasctaucture - just empty bytes)
        const extraData = "0x";

        // define timestamp, when message was created on TVM
        const timestamp = BigInt(Math.floor(Date.now() / 1000));

        // define tvm wallet address who sent message
        const tvmWalletCaller = "TVMCallerAddress1";

        // define target contract address
        const target = await proxyContract.getAddress();
        // define method name
        const methodName = "borrow(bytes,bytes)";
        // bookkeeping token
        const borrowAmount = 10n**9n;

        // encode arguments of proxy contract
        const encodedArguments = ethers.AbiCoder.defaultAbiCoder().encode(["tuple(address,uint256,uint256,uint16,address)"], [[wTON, borrowAmount, 1, 0, target]]);

        // send message
        const {receipt, deployedTokens, outMessages} = await testSdk.sendMessage(
            queryId,
            target,
            methodName,
            encodedArguments,
            tvmWalletCaller,
            [],
            [],
            0n,
            extraData,
            operationId,
            timestamp
        );
        const id = keccak256(new TextEncoder().encode(tvmWalletCaller));
        const smartAccountAddress = await proxyContract.smartAccounts(id);

        expect(receipt.status).to.be.eq(1);

        // check deployed tokens
        expect(deployedTokens.length).to.be.eq(0);

        // check out messages
        expect(outMessages.length).to.be.eq(1);
        expect(outMessages[0].tokensBurned[0].evmAddress).to.be.eq(wTON)

        // check crossChainLayer and tresaurySwap balance
        expect(await wTONContract.balanceOf(crossChainLayerAddress)).to.be.eq(0n);
        expect(await poolContract.poolTONBalance(wTON)).to.be.eq(tonBalanceBefore - borrowAmount);

    });

    it('Repay message', async () => {
        // define query id
        const queryId = 1n;
        // define operation id (it'll be created by tac infrasctaucture, but here you can define any string)
        const operationId = ethers.encodeBytes32String("test Repay message");
        // define untrusted extra data by executor (it's not implemented yet on tac infrasctaucture - just empty bytes)
        const extraData = "0x";

        // define timestamp, when message was created on TVM
        const timestamp = BigInt(Math.floor(Date.now() / 1000));

        // define tvm wallet address who sent message
        const tvmWalletCaller = "TVMCallerAddress1";
        
        // define jetton token info
        const jettonInfo: JettonInfo = {
            tvmAddress: "NONE", // jetton minter contract address
            name: "TON",
            symbol: "TON",
            decimals: 9n,
        };

        // how much jetton to mint
        const tokenMintInfo: TokenMintInfo = {
            info: jettonInfo,
            mintAmount: 10n**9n,
        }

        // define target contract address
        const target = await proxyContract.getAddress();
        // define method name
        const methodName = "repay(bytes,bytes)";
        // encode arguments of proxy contract
        const encodedArguments = ethers.AbiCoder.defaultAbiCoder().encode(["tuple(address,uint256,uint256,address)"], [[wTON, tokenMintInfo.mintAmount, 1, target]]);

        const userBorrowBefore = await poolContract.userBorrows(target, wTON);

        // send message
        const {receipt, deployedTokens, outMessages} = await testSdk.sendMessage(
            queryId,
            target,
            methodName,
            encodedArguments,
            tvmWalletCaller,
            [tokenMintInfo],
            [],
            0n,
            extraData,
            operationId,
            timestamp
        );
        
        expect(receipt.status).to.be.eq(1);
        expect(deployedTokens.length).to.be.eq(0);
        expect(await wTONContract.balanceOf(crossChainLayerAddress)).to.be.eq(0n);
        expect(await poolContract.userBorrows(target, wTON)).to.be.eq(0n);
    });
});