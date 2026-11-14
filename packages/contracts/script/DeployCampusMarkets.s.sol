// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {CampusMarkets} from "../src/CampusMarkets.sol";

interface DeployVm {
    function envAddress(string calldata name) external view returns (address);
    function envUint(string calldata name) external view returns (uint256);
    function startBroadcast(address signer) external;
    function stopBroadcast() external;
}

contract DeployCampusMarkets {
    error WrongNetwork();
    error UnsupportedConfiguredDecimals();

    DeployVm private constant vm = DeployVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant ARC_TESTNET_USDC = 0x3600000000000000000000000000000000000000;

    function run() external returns (CampusMarkets deployed) {
        if (block.chainid != 5042002) revert WrongNetwork();
        address admin = vm.envAddress("CAMPUS_ADMIN_ADDRESS");
        address lp = vm.envAddress("LIQUIDITY_PROVIDER_ADDRESS");
        uint256 decimals = vm.envUint("ARC_USDC_DECIMALS");
        if (decimals != 6) revert UnsupportedConfiguredDecimals();

        vm.startBroadcast(admin);
        deployed = new CampusMarkets(ARC_TESTNET_USDC, admin, lp, uint8(decimals));
        vm.stopBroadcast();
    }
}
