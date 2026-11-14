// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface Collateral {
    function decimals() external view returns (uint8);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

contract CampusMarkets {
    error Invalid();
    error Unauthorized();

    uint256 public constant ALLOCATION_CAP = 20e6;
    uint256 public constant FEE_BPS = 100;
    Collateral public immutable asset;
    address public immutable admin;
    address public immutable liquidityProvider;
    uint256 public available;
    uint256 public marketCount;

    enum Status {
        Draft,
        Open,
        Yes,
        No,
        Voided
    }

    struct Terms {
        string question;
        string source;
        string yesRule;
        string noRule;
        uint256 close;
        uint256 deadline;
    }

    struct Market {
        Terms terms;
        uint256 campus;
        address creator;
        address reviewer;
        Status status;
        uint256 allocation;
        uint256 sets;
        uint256 yesReserve;
        uint256 noReserve;
        uint256 fees;
        uint256 remainingClaims;
        bytes32 evidence;
    }

    struct Position {
        uint256 yes;
        uint256 no;
        uint256 debit;
        uint8 prediction;
        bool claimed;
    }

    mapping(address => uint256) public campusOf;
    mapping(address => bool) public reviewerRoster;
    mapping(uint256 => Market) private markets;
    mapping(uint256 => mapping(address => Position)) public positions;

    event CampusRegistered(address indexed wallet, uint256 campus);
    event ReviewerRosterUpdated(address indexed wallet, bool approved);
    event MarketCreated(uint256 indexed id, uint256 indexed campus, address indexed creator);
    event ReviewerAssigned(uint256 indexed id, address indexed reviewer);
    event VaultDeposited(uint256 amount);
    event VaultWithdrawn(uint256 amount);
    event MarketFunded(uint256 indexed id, uint256 allocation);
    event Purchased(
        uint256 indexed id, address indexed buyer, bool yes, uint256 principal, uint256 fee, uint256 shares
    );
    event Predicted(uint256 indexed id, address indexed student, bool yes);
    event Finalized(uint256 indexed id, Status status, bytes32 evidence, uint256 capitalReturned, uint256 feesReturned);
    event Claimed(uint256 indexed id, address indexed wallet, uint256 amount);

    constructor(address collateral, address registrar, address lp, uint8 configuredDecimals) {
        if (registrar == address(0) || lp == address(0) || registrar == lp) revert Invalid();
        if (block.chainid == 5042002 && collateral != 0x3600000000000000000000000000000000000000) revert Invalid();
        asset = Collateral(collateral);
        if (configuredDecimals != 6 || asset.decimals() != configuredDecimals) revert Invalid();
        admin = registrar;
        liquidityProvider = lp;
    }

    function register(address wallet, uint256 campus) external {
        if (msg.sender != admin) revert Unauthorized();
        if (wallet == address(0)) revert Invalid();
        campusOf[wallet] = campus;
        emit CampusRegistered(wallet, campus);
    }

    function setReviewer(address wallet, bool approved) external {
        if (msg.sender != admin) revert Unauthorized();
        if (wallet == address(0)) revert Invalid();
        reviewerRoster[wallet] = approved;
        emit ReviewerRosterUpdated(wallet, approved);
    }

    function deposit(uint256 amount) external {
        if (msg.sender != liquidityProvider) revert Unauthorized();
        if (amount == 0) revert Invalid();
        available += amount;
        if (!asset.transferFrom(msg.sender, address(this), amount)) revert Invalid();
        emit VaultDeposited(amount);
    }

    function withdraw(uint256 amount) external {
        if (msg.sender != liquidityProvider) revert Unauthorized();
        if (amount == 0 || amount > available) revert Invalid();
        available -= amount;
        if (!asset.transfer(msg.sender, amount)) revert Invalid();
        emit VaultWithdrawn(amount);
    }

    function create(Terms calldata terms) external returns (uint256 id) {
        uint256 campus = campusOf[msg.sender];
        if (campus == 0) revert Unauthorized();
        if (
            terms.close <= block.timestamp || terms.deadline <= terms.close || bytes(terms.question).length == 0
                || bytes(terms.source).length == 0 || bytes(terms.yesRule).length == 0
                || bytes(terms.noRule).length == 0
        ) revert Invalid();
        id = ++marketCount;
        Market storage m = markets[id];
        m.terms = terms;
        m.campus = campus;
        m.creator = msg.sender;
        emit MarketCreated(id, campus, msg.sender);
    }

    function getMarket(uint256 id) external view returns (Market memory) {
        return marketAt(id);
    }

    function assignReviewer(uint256 id, address reviewer) external {
        if (msg.sender != admin) revert Unauthorized();
        Market storage m = marketAt(id);
        Position storage p = positions[id][reviewer];
        if (
            m.status != Status.Draft || block.timestamp >= m.terms.close || !reviewerRoster[reviewer]
                || reviewer == m.creator || p.debit != 0 || p.prediction != 0
        ) revert Invalid();
        m.reviewer = reviewer;
        emit ReviewerAssigned(id, reviewer);
    }

    function fund(uint256 id, uint256 allocation) external {
        if (msg.sender != liquidityProvider) revert Unauthorized();
        Market storage m = marketAt(id);
        if (
            m.status != Status.Draft || !reviewerRoster[m.reviewer] || block.timestamp >= m.terms.close
                || allocation == 0 || allocation > ALLOCATION_CAP || allocation > available
        ) revert Invalid();
        available -= allocation;
        m.allocation = allocation;
        m.sets = allocation;
        m.yesReserve = allocation;
        m.noReserve = allocation;
        m.status = Status.Open;
        emit MarketFunded(id, allocation);
    }

    function quote(uint256 id, bool yes, uint256 principal)
        public
        view
        returns (uint256 shares, uint256 fee, uint256 debit)
    {
        Market storage m = marketAt(id);
        requireOpen(m);
        if (principal == 0 || principal > type(uint128).max - m.sets) revert Invalid();
        uint256 selected = yes ? m.yesReserve : m.noReserve;
        uint256 other = yes ? m.noReserve : m.yesReserve;
        // Round the remaining reserve up so shares paid to the buyer round down.
        uint256 denominator = other + principal;
        uint256 remaining = (selected * other - 1) / denominator + 1;
        shares = selected + principal - remaining;
        fee = principal * FEE_BPS / 10_000;
        debit = principal + fee;
    }

    function buy(uint256 id, bool yes, uint256 principal, uint256 minShares) external returns (uint256 shares) {
        Market storage m = marketAt(id);
        requireOpen(m);
        requireStudent(m);
        uint256 fee;
        uint256 debit;
        (shares, fee, debit) = quote(id, yes, principal);
        if (shares < minShares) revert Invalid();
        m.sets += principal;
        m.yesReserve += principal;
        m.noReserve += principal;
        m.fees += fee;
        Position storage p = positions[id][msg.sender];
        p.debit += debit;
        if (yes) {
            m.yesReserve -= shares;
            p.yes += shares;
        } else {
            m.noReserve -= shares;
            p.no += shares;
        }
        if (!asset.transferFrom(msg.sender, address(this), debit)) revert Invalid();
        emit Purchased(id, msg.sender, yes, principal, fee, shares);
    }

    function predict(uint256 id, bool yes) external {
        Market storage m = marketAt(id);
        requireOpen(m);
        requireStudent(m);
        Position storage p = positions[id][msg.sender];
        if (p.prediction != 0) revert Invalid();
        p.prediction = yes ? 1 : 2;
        emit Predicted(id, msg.sender, yes);
    }

    function score(uint256 id, address wallet) external view returns (bool scored, bool correct) {
        Status status = marketAt(id).status;
        uint8 prediction = positions[id][wallet].prediction;
        scored = prediction != 0 && (status == Status.Yes || status == Status.No);
        correct = scored && prediction == (status == Status.Yes ? 1 : 2);
    }

    function resolve(uint256 id, bool yes, bytes32 evidence) external {
        Market storage m = marketAt(id);
        if (msg.sender != m.reviewer) revert Unauthorized();
        if (
            m.status != Status.Open || block.timestamp < m.terms.close || block.timestamp >= m.terms.deadline
                || evidence == bytes32(0)
        ) revert Invalid();
        m.status = yes ? Status.Yes : Status.No;
        m.evidence = evidence;
        uint256 residual = yes ? m.yesReserve : m.noReserve;
        m.remainingClaims = m.sets - residual;
        available += residual + m.fees;
        emit Finalized(id, m.status, evidence, residual, m.fees);
    }

    function voidMarket(uint256 id) external {
        Market storage m = marketAt(id);
        if ((m.status != Status.Open && m.status != Status.Draft) || block.timestamp < m.terms.deadline) {
            revert Invalid();
        }
        m.status = Status.Voided;
        m.remainingClaims = m.sets - m.allocation + m.fees;
        available += m.allocation;
        emit Finalized(id, m.status, bytes32(0), m.allocation, 0);
    }

    function claim(uint256 id) external returns (uint256 amount) {
        Market storage m = marketAt(id);
        Position storage p = positions[id][msg.sender];
        if (p.claimed) revert Invalid();
        if (m.status == Status.Yes) amount = p.yes;
        else if (m.status == Status.No) amount = p.no;
        else if (m.status == Status.Voided) amount = p.debit;
        else revert Invalid();
        if (amount == 0) revert Invalid();
        p.claimed = true;
        m.remainingClaims -= amount;
        if (!asset.transfer(msg.sender, amount)) revert Invalid();
        emit Claimed(id, msg.sender, amount);
    }

    function marketAt(uint256 id) private view returns (Market storage m) {
        if (id == 0 || id > marketCount) revert Invalid();
        m = markets[id];
    }

    function requireOpen(Market storage m) private view {
        if (m.status != Status.Open || block.timestamp >= m.terms.close) revert Invalid();
    }

    function requireStudent(Market storage m) private view {
        if (msg.sender == m.reviewer || campusOf[msg.sender] != m.campus) revert Unauthorized();
    }
}
