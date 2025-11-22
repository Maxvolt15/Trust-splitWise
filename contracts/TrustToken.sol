// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title TrustToken — ERC20 mintable with ETH
contract TrustToken is ERC20, ReentrancyGuard {
    uint256 public immutable ethToTokenRate;

    constructor(uint256 rate) ERC20("Trust Token", "TRST") {
        require(rate > 0, "Rate must be >0");
        ethToTokenRate = rate;
    }

    /// @notice Mint TRST at fixed rate by sending ETH
    function mint() external payable nonReentrant {
        require(msg.value > 0, "Send ETH to mint");
        uint256 tokens = msg.value * ethToTokenRate;
        _mint(msg.sender, tokens);
    }


}
