// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {CampusMarkets} from "../src/CampusMarkets.sol";

interface Vm {
    function prank(address) external;
    function warp(uint256) external;
    function expectRevert(bytes4) external;
}

contract FixtureUSDC {
    uint8 public constant decimals = 6;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract MarketsTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    FixtureUSDC token;
    CampusMarkets market;
    address constant LP = address(1);
    address constant ALICE = address(2);
    address constant BOB = address(3);
    address constant CAROL = address(4);
    address constant REVIEWER = address(5);
    address constant VISITOR = address(6);
    uint256 close;
    uint256 deadline;
    uint256 id;

    function setUp() public {
        token = new FixtureUSDC();
        market = new CampusMarkets(address(token), address(this), LP);
        address[6] memory wallets = [LP, ALICE, BOB, CAROL, REVIEWER, VISITOR];
        for (uint256 i; i < wallets.length; ++i) {
            token.mint(wallets[i], 200e6);
            vm.prank(wallets[i]);
            token.approve(address(market), 200e6);
            market.register(wallets[i], i == 5 ? 2 : 1);
        }
        vm.prank(LP);
        market.deposit(100e6);
        close = block.timestamp + 1 hours;
        deadline = close + 1 hours;
        vm.prank(ALICE);
        id = market.create(CampusMarkets.Terms("Will it pass?", "Official results", "Pass", "Fail", close, deadline));
        market.setReviewer(REVIEWER, true);
        market.assignReviewer(id, REVIEWER);
    }

    function fund() internal {
        vm.prank(LP);
        market.fund(id, 20e6);
    }

    function buy(address who, bool yes, uint256 principal) internal returns (uint256 shares) {
        (uint256 quoted,,) = market.quote(id, yes, principal);
        vm.prank(who);
        shares = market.buy(id, yes, principal, quoted);
        require(shares == quoted, "execution differs from preview");
    }

    function testFourUnitPurchaseRoundsSharesDown() public {
        fund();
        (uint256 shares, uint256 fee, uint256 debit) = market.quote(id, true, 4e6);
        require(shares == 7_333_333 && fee == 40_000 && debit == 4_040_000);
        uint256 before = token.balanceOf(ALICE);
        require(buy(ALICE, true, 4e6) == shares);
        require(before - token.balanceOf(ALICE) == debit);
    }

    function testLateResolutionAndReservedRefunds() public {
        fund();
        buy(ALICE, true, 4e6);
        vm.prank(BOB);
        market.predict(id, false);
        vm.expectRevert(CampusMarkets.Invalid.selector);
        market.voidMarket(id);
        vm.warp(deadline);
        vm.expectRevert(CampusMarkets.Invalid.selector);
        vm.prank(REVIEWER);
        market.resolve(id, true, bytes32(uint256(1)));
        market.voidMarket(id);
        (bool scored,) = market.score(id, BOB);
        require(!scored);
        vm.expectRevert(CampusMarkets.Invalid.selector);
        vm.prank(LP);
        market.withdraw(100e6 + 1);
        vm.prank(LP);
        market.withdraw(100e6);
        market.register(ALICE, 0);
        vm.prank(ALICE);
        require(market.claim(id) == 4_040_000);
        require(token.balanceOf(address(market)) == 0);
    }

    function testEveryClaimOrderBothOutcomesAndVoid() public {
        uint256 snapshot;
        for (uint256 result; result < 3; ++result) {
            for (uint256 order; order < 6; ++order) {
                snapshot = SnapshotVm(address(vm)).snapshotState();
                checkClaims(result, order);
                require(SnapshotVm(address(vm)).revertToState(snapshot));
            }
        }
    }

    function checkClaims(uint256 result, uint256 order) internal {
        fund();
        address[3] memory wallets = [ALICE, BOB, CAROL];
        uint256[3] memory payouts;
        for (uint256 i; i < 3; ++i) {
            uint256 principal = (i + 1) * 1_777_777;
            (,, uint256 yesDebit) = market.quote(id, true, principal);
            uint256 yes = buy(wallets[i], true, principal);
            (,, uint256 noDebit) = market.quote(id, false, principal + 3);
            uint256 no = buy(wallets[i], false, principal + 3);
            payouts[i] = result == 2 ? yesDebit + noDebit : result == 0 ? yes : no;
        }
        uint256 held = token.balanceOf(address(market));
        vm.warp(result == 2 ? deadline : close);
        if (result == 2) {
            market.voidMarket(id);
        } else {
            vm.prank(REVIEWER);
            market.resolve(id, result == 0, bytes32(uint256(1)));
        }
        require(held == market.available() + payouts[0] + payouts[1] + payouts[2]);
        if (result == 2) require(market.available() == 100e6);
        for (uint256 j; j < 3; ++j) {
            uint256 i = (order / 2 + (order % 2 == 0 ? j : 3 - j)) % 3;
            vm.prank(wallets[i]);
            require(market.claim(id) == payouts[i]);
            vm.expectRevert(CampusMarkets.Invalid.selector);
            vm.prank(wallets[i]);
            market.claim(id);
        }
        require(token.balanceOf(address(market)) == market.available());
    }

    function testEligibilityReviewerAndDeadlines() public {
        vm.expectRevert(CampusMarkets.Invalid.selector);
        vm.prank(ALICE);
        market.buy(id, true, 4e6, 0);
        vm.expectRevert(CampusMarkets.Invalid.selector);
        market.assignReviewer(id, BOB);
        market.setReviewer(ALICE, true);
        vm.expectRevert(CampusMarkets.Invalid.selector);
        market.assignReviewer(id, ALICE);
        vm.expectRevert(CampusMarkets.Unauthorized.selector);
        vm.prank(VISITOR);
        market.register(VISITOR, 1);
        fund();
        vm.expectRevert(CampusMarkets.Unauthorized.selector);
        vm.prank(VISITOR);
        market.buy(id, true, 4e6, 0);
        vm.expectRevert(CampusMarkets.Unauthorized.selector);
        vm.prank(VISITOR);
        market.predict(id, true);
        vm.expectRevert(CampusMarkets.Unauthorized.selector);
        vm.prank(REVIEWER);
        market.buy(id, true, 4e6, 0);
        vm.expectRevert(CampusMarkets.Unauthorized.selector);
        vm.prank(REVIEWER);
        market.predict(id, true);
        vm.expectRevert(CampusMarkets.Invalid.selector);
        vm.prank(ALICE);
        market.buy(id, true, 4e6, 9e6);
        vm.prank(BOB);
        market.predict(id, false);
        market.setReviewer(BOB, true);
        vm.expectRevert(CampusMarkets.Invalid.selector);
        market.assignReviewer(id, BOB);
        vm.expectRevert(CampusMarkets.Invalid.selector);
        vm.prank(BOB);
        market.predict(id, true);
        vm.warp(close);
        vm.expectRevert(CampusMarkets.Invalid.selector);
        vm.prank(ALICE);
        market.buy(id, true, 4e6, 0);
        vm.expectRevert(CampusMarkets.Unauthorized.selector);
        market.resolve(id, false, bytes32(uint256(1)));
        vm.prank(REVIEWER);
        market.resolve(id, false, bytes32(uint256(1)));
        vm.expectRevert(CampusMarkets.Invalid.selector);
        vm.prank(REVIEWER);
        market.resolve(id, false, bytes32(uint256(1)));
        (bool scored, bool correct) = market.score(id, BOB);
        require(scored && correct);
    }
}

interface SnapshotVm {
    function snapshotState() external returns (uint256);
    function revertToState(uint256) external returns (bool);
}
