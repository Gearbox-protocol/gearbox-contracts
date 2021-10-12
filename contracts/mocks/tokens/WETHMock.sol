pragma solidity ^0.7.4;

import "hardhat/console.sol";

contract WETHMock {
    string public name     = "Wrapped Ether";
    string public symbol   = "WETH";
    uint8  public decimals = 18;

    event  Approval(address indexed src, address indexed guy, uint wad);
    event  Transfer(address indexed src, address indexed dst, uint wad);
    event  Deposit(address indexed dst, uint wad);
    event  Withdrawal(address indexed src, uint wad);

    mapping (address => uint)                       public  balanceOf;
    mapping (address => mapping (address => uint))  public  allowance;

    function mint(address to, uint256 amount ) external {
        balanceOf[to] += amount;
    }

    receive() external payable {
        deposit(); // T:[WM-1]
    }
    function deposit() public payable {
        balanceOf[msg.sender] += msg.value; // T:[WM-1]
        emit Deposit(msg.sender, msg.value); // T:[WM-1]
    }

    function withdraw(uint wad) public {
        require(balanceOf[msg.sender] >= wad); // T:[WM-2]
        balanceOf[msg.sender] -= wad; // T:[WM-2]
        msg.sender.transfer(wad); // T:[WM-3]
        emit Withdrawal(msg.sender, wad); // T:[WM-4]
    }

    function totalSupply() public view returns (uint) {
        return address(this).balance; // T:[WM-1, 2]
    }

    function approve(address guy, uint wad) public returns (bool) {
        allowance[msg.sender][guy] = wad; // T:[WM-3]
        emit Approval(msg.sender, guy, wad); // T:[WM-3]
        return true;
    }

    function transfer(address dst, uint wad) public returns (bool) {
        return transferFrom(msg.sender, dst, wad); // T:[WM-4,5,6]
    }

    function transferFrom(address src, address dst, uint wad)
    public
    returns (bool)
    {
        require(balanceOf[src] >= wad); // T:[WM-4]

        if (src != msg.sender && allowance[src][msg.sender] != uint(-1)) {
            require(allowance[src][msg.sender] >= wad); // T:[WM-4]
            allowance[src][msg.sender] -= wad; // T:[WM-7]
        }

        balanceOf[src] -= wad; // T:[WM-5]
        balanceOf[dst] += wad; // T:[WM-5]
 
        emit Transfer(src, dst, wad); // T:[WM-6]

        return true;
    }
}
