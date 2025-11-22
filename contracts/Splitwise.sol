// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title Gas-Optimized Splitwise with State Commitments
contract Splitwise is ReentrancyGuard {
    using SafeERC20 for IERC20;
    
    struct Group {
        address[] members;
        mapping(address => bool) isMember;
        bool exists;
        bytes32 debtGraphHash; // State commitment
        uint256 expenseNonce;  // Expense salting counter
    }

    struct SimplifiedEdge {
        address debtor;
        address creditor;
        uint256 amount;
    }

    IERC20 public immutable token;
    uint256 public groupCount;

    // debts[groupId][debtor][creditor]
    mapping(uint256 => mapping(address => mapping(address => uint256))) public debts;
    mapping(uint256 => Group) private groups;
    
    // Commit-reveal state for simplifications
    mapping(bytes32 => bool) public submittedSimplifications;

    // Events
    event GroupCreated(uint256 indexed groupId, address[] members);
    event MemberJoined(uint256 indexed groupId, address member);
    event ExpenseRegistered(
        uint256 indexed groupId, 
        address indexed payer, 
        uint256 amount,
        bytes32 expenseHash
    );
    event SimplificationSubmitted(
        uint256 indexed groupId, 
        bytes32 edgesHash,
        address submitter
    );
    event DebtsSimplified(uint256 indexed groupId, bytes32 edgesHash);
    event DebtSettled(
        uint256 indexed groupId, 
        address indexed debtor, 
        address indexed creditor, 
        uint256 amount
    );

    modifier onlyGroupExists(uint256 gid) {
        require(groups[gid].exists, "Group not found");
        _;
    }
    
    modifier onlyMember(uint256 gid) {
        require(groups[gid].isMember[msg.sender], "Not a group member");
        _;
    }

    constructor(address tokenAddress) {
        require(tokenAddress != address(0), "Zero token address");
        token = IERC20(tokenAddress);
    }

    /// @notice Create group with state commitment
    function createGroup(address[] calldata members) external {
        require(members.length >= 2, "Need >= 2 members");
        uint256 gid = groupCount++;
        Group storage g = groups[gid];
        g.exists = true;
        
        for (uint i; i < members.length; ) {
            address m = members[i];
            require(!g.isMember[m], "Duplicate member");
            require(m != address(0), "Zero address");
            g.isMember[m] = true;
            g.members.push(m);
            unchecked { ++i; }
        }
        g.debtGraphHash = keccak256(abi.encode(new SimplifiedEdge[](0)));
        emit GroupCreated(gid, members);
    }

    /// @notice Join group with safety checks
    function joinGroup(uint256 gid) external onlyGroupExists(gid) {
        Group storage g = groups[gid];
        require(!g.isMember[msg.sender], "Already joined");
        g.isMember[msg.sender] = true;
        g.members.push(msg.sender);
        emit MemberJoined(gid, msg.sender);
    }

    /// @notice Register expense with salted hash
    function registerExpense(
        uint256 gid,
        uint256 amount,
        uint8 splitType,
        address[] calldata parts,
        uint256[] calldata values
    ) external onlyGroupExists(gid) onlyMember(gid) {
        require(parts.length >= 1, "No participants");
        
        Group storage g = groups[gid];
        bytes32 expenseHash = keccak256(
            abi.encode(
                gid,               // Group context
                amount,
                splitType,
                parts,
                values,
                g.expenseNonce++    // Salting element
            )
        );
        
        if (splitType == 0) {
            _processEqualSplit(gid, amount, parts);
        } else {
            _processExactSplit(gid, amount, parts, values);
        }
        emit ExpenseRegistered(gid, msg.sender, amount, expenseHash);
    }

    function _processEqualSplit(
        uint256 gid,
        uint256 amount,
        address[] calldata parts
    ) private {
        uint256 n = parts.length;
        uint256 share = amount / n;
        Group storage g = groups[gid];
        
        for (uint i; i < n; ) {
            address p = parts[i];
            require(g.isMember[p], "Not in group");
            
            if (p != msg.sender) {
                debts[gid][p][msg.sender] += share;
            }
            unchecked { ++i; }
        }
    }

    function _processExactSplit(
        uint256 gid,
        uint256 amount,
        address[] calldata parts,
        uint256[] calldata values
    ) private {
        uint256 n = parts.length;
        require(values.length == n, "Values mismatch");
        uint256 sum;
        Group storage g = groups[gid];
        
        for (uint i; i < n; ) {
            sum += values[i];
            unchecked { ++i; }
        }
        require(sum == amount, "Sum != amount");
        
        for (uint i; i < n; ) {
            address p = parts[i];
            require(g.isMember[p], "Not in group");
            if (p != msg.sender) {
                debts[gid][p][msg.sender] += values[i];
            }
            unchecked { ++i; }
        }
    }

    /// @notice Commit simplified edges with hash
    function commitSimplification(
        uint256 gid, 
        bytes32 edgesHash
    ) external onlyGroupExists(gid) onlyMember(gid) {
        submittedSimplifications[edgesHash] = true;
        emit SimplificationSubmitted(gid, edgesHash, msg.sender);
    }

    /// @notice Apply pre-committed simplification
    function applySimplification(
        uint256 gid, 
        SimplifiedEdge[] calldata edges,
        bytes32 edgesHash
    ) external onlyGroupExists(gid) onlyMember(gid) {
        // Ensure that the simplification has been pre-committed and that the provided
        // edges match the committed hash. This prevents applying a non-verified simplification.
        require(
            submittedSimplifications[edgesHash], 
            "Hash not committed"
        );
        require(
            edgesHash == keccak256(abi.encode(edges)),
            "Invalid edges"
        );
        
        Group storage g = groups[gid];

        // To apply the new simplified debt graph, we first need to clear the existing debts.
        // This is done by iterating through all possible pairs of members and setting their debt to 0.
        // This is a gas-intensive operation, but it is necessary for correctness.
        for (uint i; i < g.members.length; ) {
            address u = g.members[i];
            for (uint j; j < g.members.length; ) {
                address v = g.members[j];
                if (debts[gid][u][v] > 0) {
                    debts[gid][u][v] = 0;
                }
                unchecked { ++j; }
            }
            unchecked { ++i; }
        }
        
        // With the old debts cleared, we now apply the new, simplified debt edges.
        for (uint i; i < edges.length; ) {
            SimplifiedEdge calldata e = edges[i];
            require(g.isMember[e.debtor], "Invalid debtor");
            require(g.isMember[e.creditor], "Invalid creditor");
            require(e.debtor != e.creditor, "Self-debt not allowed");
            debts[gid][e.debtor][e.creditor] = e.amount;
            unchecked { ++i; }
        }
        
        // Finally, we update the group's debt graph hash to the new simplified hash
        // and remove the pre-committed hash to prevent it from being used again.
        g.debtGraphHash = edgesHash;
        delete submittedSimplifications[edgesHash];
        emit DebtsSimplified(gid, edgesHash);
    }

    /// @notice Return the full member list for a group
    function getMembers(uint256 gid)
        external
        view
        onlyGroupExists(gid)
        returns (address[] memory)
    {
        return groups[gid].members;
    }

    /// @notice Secure debt settlement
    function settleDebt(
        uint256 gid, 
        address creditor, 
        uint256 amount
    ) external nonReentrant onlyGroupExists(gid) onlyMember(gid) {
        uint256 owe = debts[gid][msg.sender][creditor];
        require(owe >= amount, "Exceeds debt");
        require(creditor != address(0), "Zero creditor address");
        
        // Update state before external call
        debts[gid][msg.sender][creditor] = owe - amount;
        
        // Safe ERC-20 transfer
        token.safeTransferFrom(msg.sender, creditor, amount);
        emit DebtSettled(gid, msg.sender, creditor, amount);
    }
}

library SafeERC20 {
    function safeTransferFrom(
        IERC20 token,
        address from,
        address to,
        uint256 value
    ) internal {
        (bool success, bytes memory data) = address(token).call(
            abi.encodeWithSelector(
                token.transferFrom.selector, 
                from, 
                to, 
                value
            )
        );
        require(
            success && (data.length == 0 || abi.decode(data, (bool))),
            "Transfer failed"
        );
    }
}