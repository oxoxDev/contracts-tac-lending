// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;
// TON USER --> connecting with our DAPP --> send tx using the tac-sdk to the CCL --> the Zerolend Proxy on TAC_TURIN --> Zerolend on TAC_TURIN
import "@openzeppelin/contracts/proxy/beacon/BeaconProxy.sol";
import "@openzeppelin/contracts/proxy/beacon/UpgradeableBeacon.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

// Standard Proxy Imports
import {AppProxy} from "../proxy/AppProxy.sol";
import {OutMessage, TokenAmount, TacHeaderV1} from "tac-l2-ccl/contracts/L2/Structs.sol";

// Pool Imports
import {IPool} from "../interfaces/IPool.sol";
import {IPoolProxy} from "../interfaces/IPoolProxy.sol";
import {TransferHelper} from "../lib/TransferHelper.sol";

// SmartAccount Imports
import {IZLSmartAccount} from "../interfaces/IZLSmartAccount.sol";

/**
 * @title PoolProxy
 * @dev Proxy contract for interacting with the Pool contract.
 * This contract handles supply, withdraw, borrow, and repay operations.
 */
contract PoolProxy is AppProxy, OwnableUpgradeable, IPoolProxy {
    UpgradeableBeacon public beacon;
    mapping(bytes32 => address) public smartAccounts;

    /**
     * @notice Emitted when a new smartAccount is generated
     * @param accountAddress Address of the generated SmartAccount
     */
    event SmartAccountCreated(address indexed accountAddress);

    /**
     * @dev Constructor to initialize the contract with the application and settings addresses.
     * @param appAddress The address of the application contract.
     * @param settingsAddress The address of the settings contract.
     */
    constructor(
        address appAddress,
        address settingsAddress
    ) AppProxy(appAddress, settingsAddress) {}

    function initialize(address _smartAccountBluePrint) public initializer {
        beacon = new UpgradeableBeacon(_smartAccountBluePrint, msg.sender);
    }

    /**
     * @dev External function to handle the supply operation via cross-chain layer.
     * @param tacHeader The TAC header for cross-chain communication.
     * @param arguments The encoded supply arguments.
     */
    function supply(
        bytes calldata tacHeader,
        bytes calldata arguments
    ) external payable onlyCrossChainLayer {
        SupplyArguments memory args = abi.decode(arguments, (SupplyArguments));
        TacHeaderV1 memory header = _decodeTacHeader(tacHeader);
        _supply(args, header);
    }

    /**
     * @dev External function to handle the withdraw operation via cross-chain layer.
     * @param tacHeader The TAC header for cross-chain communication.
     * @param arguments The encoded withdraw arguments.
     */
    function withdraw(
        bytes calldata tacHeader,
        bytes calldata arguments
    ) external payable onlyCrossChainLayer {
        WithdrawArguments memory args = abi.decode(
            arguments,
            (WithdrawArguments)
        );
        TacHeaderV1 memory header = _decodeTacHeader(tacHeader);
        TokenAmount[] memory tokensToBridge = _withdraw(args, header);

        // Approve tokens for bridging
        for (uint256 i = 0; i < tokensToBridge.length; ) {
            TransferHelper.safeApprove(
                tokensToBridge[i].l2Address,
                getCrossChainLayerAddress(),
                tokensToBridge[i].amount
            );
            unchecked {
                ++i;
            }
        }

        // CCL TAC->TON callback
        OutMessage memory message = OutMessage({
            queryId: header.queryId,
            tvmTarget: header.tvmCaller,
            tvmPayload: "",
            toBridge: tokensToBridge
        });

        sendMessage(message, 0);
    }

    /**
     * @dev External function to handle the borrow operation via cross-chain layer.
     * @param tacHeader The TAC header for cross-chain communication.
     * @param arguments The encoded borrow arguments.
     */
    function borrow(
        bytes calldata tacHeader,
        bytes calldata arguments
    ) external payable onlyCrossChainLayer {
        BorrowArguments memory args = abi.decode(arguments, (BorrowArguments));
        TacHeaderV1 memory header = _decodeTacHeader(tacHeader);
        _borrow(args, header);

        TokenAmount[] memory tokensToBridge = new TokenAmount[](1);
        tokensToBridge[0] = TokenAmount(args.asset, args.amount);

        // Approve tokens for bridging
        TransferHelper.safeApprove(tokensToBridge[0].l2Address, getCrossChainLayerAddress(), tokensToBridge[0].amount);

        // CCL TAC->TON callback
        OutMessage memory message = OutMessage({
            queryId: header.queryId,
            tvmTarget: header.tvmCaller,
            tvmPayload: "",
            toBridge: tokensToBridge
        });

        sendMessage(message, 0);
    }

    /**
     * @dev External function to handle the repay operation via cross-chain layer.
     * @param tacHeader The TAC header for cross-chain communication.
     * @param arguments The encoded repay arguments.
     */
    function repay(
        bytes calldata tacHeader,
        bytes calldata arguments
    ) external payable onlyCrossChainLayer {
        RepayArguments memory args = abi.decode(arguments, (RepayArguments));
        TacHeaderV1 memory header = _decodeTacHeader(tacHeader);
        _repay(args, header);
    }

    /**
     * @dev Internal function to handle the supply operation.
     * @param arguments The supply arguments containing asset, amount, and onBehalfOf details.
     */
    function _supply(
        SupplyArguments memory arguments,
        TacHeaderV1 memory header
    ) internal {
        // Get or create the Smart Account
        address smartAccount = _getOrCreateSmartAccount(header.tvmCaller);

        // Grant token approvals
        TransferHelper.safeApprove(
            arguments.asset,
            _appAddress,
            arguments.amount
        );

        // Proxy call to the Pool contract
        IPool(_appAddress).supply(
            arguments.asset,
            arguments.amount,
            smartAccount,
            arguments.referralCode
        );
    }

    /**
     * @dev Internal function to handle the withdraw operation.
     * @param arguments The withdraw arguments containing asset, amount, and to details.
     * @return tokensToBridge An array of TokenAmount to be bridged.
     */
    function _withdraw(
        WithdrawArguments memory arguments,
        TacHeaderV1 memory header
    ) internal returns (TokenAmount[] memory) {
        // Get or create the Smart Account
        address smartAccount = _getOrCreateSmartAccount(header.tvmCaller);

        //Approve the Pool to pull the ATokens from smart account
        IZLSmartAccount(smartAccount).approve(
            IPool(_appAddress).token(),
            _appAddress,
            arguments.amount
        );

        bytes memory data = abi.encodeWithSignature(
            "withdraw(address,uint256,address)",
            arguments.asset,
            arguments.amount,
            smartAccount
        );

        // Proxy call to the Pool contract
        bytes memory result = IZLSmartAccount(smartAccount).execute(
            _appAddress,
            0,
            data
        );
        uint256 withdrawnAmount = abi.decode(result, (uint256));

        TokenAmount[] memory tokensToBridge = new TokenAmount[](1);
        tokensToBridge[0] = TokenAmount({
            l2Address: arguments.asset,
            amount: withdrawnAmount
        });

        return tokensToBridge;
    }

    /**
     * @dev Internal function to handle the borrow operation.
     * @param arguments The borrow arguments containing asset, amount, interestRateMode, referralCode, and onBehalfOf details.
     */
    function _borrow(
        BorrowArguments memory arguments,
        TacHeaderV1 memory header
    ) internal {
        // Get or create the Smart Account
        address smartAccount = _getOrCreateSmartAccount(header.tvmCaller);

        // Proxy call to the Pool contract
        IPool(_appAddress).borrow(
            arguments.asset,
            arguments.amount,
            arguments.interestRateMode,
            arguments.referralCode,
            smartAccount
        );
    }

    /**
     * @dev Internal function to handle the repay operation.
     * @param arguments The repay arguments containing asset, amount, interestRateMode, and onBehalfOf details.
     */
    function _repay(
        RepayArguments memory arguments,
        TacHeaderV1 memory header
    ) internal {
        // Get or create the Smart Account
        address smartAccount = _getOrCreateSmartAccount(header.tvmCaller);

        // Grant token approvals
        TransferHelper.safeApprove(
            arguments.asset,
            _appAddress,
            arguments.amount
        );
        
        IPool(_appAddress).repay(arguments.asset, arguments.amount, arguments.interestRateMode, smartAccount);

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

    function _createSmartAccount() internal returns (address) {
        BeaconProxy proxy = new BeaconProxy(
            address(beacon),
            abi.encodeWithSelector(
                IZLSmartAccount.initialize.selector,
                address(this)
            )
        );
        emit SmartAccountCreated(address(proxy));
        return address(proxy);
    }
}