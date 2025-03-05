// SPDX-License-Identifier: GPL-3.0
pragma solidity >=0.8.2 <0.9.0;

import "@openzeppelin/contracts/proxy/beacon/BeaconProxy.sol";
import "@openzeppelin/contracts/proxy/beacon/UpgradeableBeacon.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {ICrossChainLayer} from "tac-l2-ccl/contracts/interfaces/ICrossChainLayer.sol";
import {OutMessage, TacHeaderV1, TokenAmount} from "tac-l2-ccl/contracts/L2/Structs.sol";
import {TacProxyV1} from "tac-l2-ccl/contracts/proxies/TacProxyV1.sol";
import { ITonProxyApp } from "../interfaces/ITonProxyApp.sol";
import { IPool } from "@zerolendxyz/core-v3/contracts/interfaces/IPool.sol";
import { ISmartAccount } from "../interfaces/ISmartAccount.sol";

contract TonProxyApp is TacProxyV1, OwnableUpgradeable, ITonProxyApp {
    IPool public pool;
    UpgradeableBeacon public beacon;

    mapping(bytes32 => address) public smartAccounts;

    ICrossChainLayer public immutable crossChainLayer;

    event InvokeWithCallback(
        uint64 queryId,
        uint256 timestamp,
        bytes32 operationId,
        string tvmCaller,
        bytes extraData,
        TokenAmount[] receivedTokens
    );

    event SmartAccountCreated(address indexed accountAddress);

    modifier onlyCrossChainLayer() {
        require(
            msg.sender == address(crossChainLayer),
            "Only the CrossChainLayer can call this function"
        );
        _;
    }

    constructor(ICrossChainLayer _crossChainLayer) {
        crossChainLayer = _crossChainLayer;
    }

    function initialize(
        address _initBlueprint,
        address _pool
    ) public initializer {
        pool = IPool(_pool);
        beacon = new UpgradeableBeacon(_initBlueprint, msg.sender);
    }

    function invokeWithCallback(
        bytes calldata tacHeader,
        bytes calldata arguments
    ) external onlyCrossChainLayer {
        // Decode the header
        TacHeaderV1 memory header = _decodeTacHeader(tacHeader);

        // Decode the token list
        TokenAmount[] memory receivedTokens = abi.decode(
            arguments,
            (TokenAmount[])
        );

        // then we can call dapp contract

        // Emit the event (optional - for your internal logging)
        emit InvokeWithCallback(
            header.queryId,
            header.timestamp,
            header.operationId,
            header.tvmCaller,
            header.extraData,
            receivedTokens
        );

        // Approve and send tokens back through the cross-chain layer
        for (uint256 i = 0; i < receivedTokens.length; i++) {
            IERC20(receivedTokens[i].l2Address).approve(
                address(crossChainLayer),
                receivedTokens[i].amount
            );
        }

        crossChainLayer.sendMessage(
            OutMessage(header.queryId, header.tvmCaller, "", receivedTokens)
        );
    }

    // function supply(address token, uint256 amount) external {
    //     address to = _getOrCreateSmartAccount("test");
    //     IERC20(token).approve(address(pool), amount);
    //     pool.supply(token, amount, to, 0);
    // }

    function supplyZerolend(
        bytes calldata tacHeader,
        bytes calldata arguments
    ) external onlyCrossChainLayer {
        // Decode the header
        TacHeaderV1 memory header = _decodeTacHeader(tacHeader);

        // Decode arguments structure
        SupplyParams memory params = abi.decode(arguments, (SupplyParams));

        // Get or create the Smart Account
        address smartAccount = _getOrCreateSmartAccount(header.tvmCaller);

        IERC20(params.asset).approve(address(pool), params.amount);

        // Supply tokens to the pool
        pool.supply(params.asset, params.amount, smartAccount, params.referralCode);

        // Create an array of tokens to bridge back to TON
        TokenAmount[] memory tokensToBridge = new TokenAmount[](1);
        tokensToBridge[0] = TokenAmount(params.asset, IERC20(params.asset).balanceOf(address(this)));
        IERC20(params.asset).approve(address(crossChainLayer), IERC20(params.asset).balanceOf(address(this)));

        // Create an OutMessage to send to TON
        OutMessage memory outMsg = OutMessage({
            queryId: header.queryId,
            tvmTarget: header.tvmCaller,
            tvmPayload: "",
            toBridge: tokensToBridge
        });

        // Send the message to the CrossChainLayer
        crossChainLayer.sendMessage(outMsg);
    }

    function updateBlueprint(address _newBlueprint) external onlyOwner {
        beacon.upgradeTo(_newBlueprint);
    }

    /// @dev tvmWallet is the address of the TON wallet
    function _getOrCreateSmartAccount(
        string memory tvmWallet
    ) internal returns (address) {
        bytes32 id = keccak256(abi.encodePacked(tvmWallet));
        if (smartAccounts[id] != address(0)) {
            return smartAccounts[id];
        }

        address account = _createSmartAccount();
        smartAccounts[id] = account;
        return account;
    }

    function _createSmartAccount() internal onlyOwner returns (address) {
        BeaconProxy proxy = new BeaconProxy(
            address(beacon),
            abi.encodeWithSelector(
                ISmartAccount.initialize.selector,
                address(this)
            )
        );
        emit SmartAccountCreated(address(proxy));
        return address(proxy);
    }
}