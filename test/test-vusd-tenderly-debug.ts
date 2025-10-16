// test/test-vusd-tenderly-debug.ts
// Test script for VusdArbitrage contract on Tenderly fork
// Strategy: Impersonate USDC whale, fund deployer and contract ONCE in before() block
// Then run multiple tests against the same funded contract instance

import { ethers } from 'hardhat';
import { expect } from 'chai';
import { VusdArbitrage } from '../typechain-types';
import { VusdArbitrage__factory } from '../typechain-types/factories/contracts/VusdArbitrage.sol';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { Contract } from 'ethers';

// Helper function to convert human-readable USDC amount to 6-decimal format
const toUsdc = (amount: number | string) => ethers.utils.parseUnits(amount.toString(), 6);

describe('VusdArbitrage Tenderly Fork Test (With Whale Funding)', () => {
  let vusdArbitrage: VusdArbitrage;
  let deployer: SignerWithAddress;
  let usdcContract: Contract;

  // Mainnet contract addresses
  const USDC_ADDRESS = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
  const CRVUSD_ADDRESS = '0xf939E0A03FB07F59A73314E73794Be0E57ac1b4E';
  const VUSD_ADDRESS = '0x677ddbd918637E5F2c79e164D402454dE7dA8619';
  const VUSD_MINTER = '0x3C8aeF08d90C2418f8AE887af47ba7d8Db88AF6b';
  const VUSD_REDEEMER = '0x43c704BC0F773B529E871EAAF4E283C2233512F9';
  const CURVE_CRVUSD_USDC_POOL = '0x4DEcE678ceceb27446b35C672dC7d61F30bAD69E';
  const CURVE_CRVUSD_VUSD_POOL = '0xB1c189dfDe178FE9F90E72727837cC9289fB944F';
  const UNISWAP_V3_USDC_POOL = '0x919b20Ac45304AEB09C9df5c604b3CD9D99a51cA';

  // Discovered Curve pool token indices (from deployment)
  const CRVUSD_USDC_POOL_USDC_INDEX = 0;
  const CRVUSD_USDC_POOL_CRVUSD_INDEX = 1;
  const CRVUSD_VUSD_POOL_CRVUSD_INDEX = 0;
  const CRVUSD_VUSD_POOL_VUSD_INDEX = 1;

  // Whale address with ~1 billion USDC on mainnet
  const USDC_WHALE = '0xE20d20b0cC4e44Cd23D5B0488D5250A9ac426875';

  // This before() block runs ONCE for all tests in this suite
  // It deploys the contract and funds it, so all tests share the same funded instance
  before(async () => {
    console.log('\n' + '='.repeat(70));
    console.log('SETUP: Deploying Contract and Funding with USDC');
    console.log('='.repeat(70));

    // Get the deployer signer (your account)
    [deployer] = await ethers.getSigners();
    console.log(`\nDeployer address: ${deployer.address}`);

    // ========================================================================
    // STEP 1: Deploy VusdArbitrage Contract
    // ========================================================================
    console.log('\nSTEP 1: Deploying VusdArbitrage contract...');
    const factory = (await ethers.getContractFactory('VusdArbitrage', deployer)) as VusdArbitrage__factory;
    vusdArbitrage = await factory.deploy(
      USDC_ADDRESS,
      CRVUSD_ADDRESS,
      VUSD_ADDRESS,
      VUSD_MINTER,
      VUSD_REDEEMER,
      CURVE_CRVUSD_USDC_POOL,
      CURVE_CRVUSD_VUSD_POOL,
      UNISWAP_V3_USDC_POOL,
      CRVUSD_USDC_POOL_USDC_INDEX,
      CRVUSD_USDC_POOL_CRVUSD_INDEX,
      CRVUSD_VUSD_POOL_CRVUSD_INDEX,
      CRVUSD_VUSD_POOL_VUSD_INDEX
    );
    await vusdArbitrage.deployed();
    console.log(`Contract deployed at: ${vusdArbitrage.address}`);

    // Get USDC contract interface
    usdcContract = await ethers.getContractAt('IERC20', USDC_ADDRESS);

    // ========================================================================
    // STEP 2: Impersonate USDC Whale
    // ========================================================================
    console.log('\nSTEP 2: Impersonating USDC whale...');
    console.log(`Whale address: ${USDC_WHALE}`);
    
    // Check whale's balance before impersonation
    const whaleBalanceBefore = await usdcContract.balanceOf(USDC_WHALE);
    console.log(`Whale USDC balance: ${ethers.utils.formatUnits(whaleBalanceBefore, 6)} USDC`);

    // Use Hardhat's special RPC method to impersonate the whale
    // This allows us to send transactions as if we were the whale
    await ethers.provider.send("hardhat_impersonateAccount", [USDC_WHALE]);
    const whaleSigner = await ethers.getSigner(USDC_WHALE);
    console.log('Whale impersonation active');

    // Give the whale 10 ETH for gas (impersonated accounts start with 0 ETH)
    await ethers.provider.send("hardhat_setBalance", [
      USDC_WHALE,
      ethers.utils.hexValue(ethers.utils.parseEther("10"))
    ]);
    const whaleEthBalance = await ethers.provider.getBalance(USDC_WHALE);
    console.log(`Whale ETH balance: ${ethers.utils.formatEther(whaleEthBalance)} ETH`);

    // ========================================================================
    // STEP 3: Transfer USDC from Whale to Deployer
    // ========================================================================
    console.log('\nSTEP 3: Transferring 100,000 USDC from whale to deployer...');
    
    // Check deployer balance before transfer
    const deployerBalanceBefore = await usdcContract.balanceOf(deployer.address);
    console.log(`Deployer USDC before: ${ethers.utils.formatUnits(deployerBalanceBefore, 6)} USDC`);

    // Transfer 100,000 USDC from whale to deployer
    const transferToDeployer = await usdcContract.connect(whaleSigner).transfer(
      deployer.address,
      toUsdc(100000)
    );
    await transferToDeployer.wait();
    console.log('Transfer to deployer complete');

    // Check deployer balance after transfer
    const deployerBalanceAfter = await usdcContract.balanceOf(deployer.address);
    console.log(`Deployer USDC after: ${ethers.utils.formatUnits(deployerBalanceAfter, 6)} USDC`);

    // ========================================================================
    // STEP 4: Transfer USDC from Deployer to Contract
    // ========================================================================
    console.log('\nSTEP 4: Transferring 50,000 USDC from deployer to contract...');
    
    // Check contract balance before transfer
    const contractBalanceBefore = await usdcContract.balanceOf(vusdArbitrage.address);
    console.log(`Contract USDC before: ${ethers.utils.formatUnits(contractBalanceBefore, 6)} USDC`);

    // Transfer 50,000 USDC from deployer to contract
    const transferToContract = await usdcContract.connect(deployer).transfer(
      vusdArbitrage.address,
      toUsdc(50000)
    );
    await transferToContract.wait();
    console.log('Transfer to contract complete');

    // Check contract balance after transfer
    const contractBalanceAfter = await usdcContract.balanceOf(vusdArbitrage.address);
    console.log(`Contract USDC after: ${ethers.utils.formatUnits(contractBalanceAfter, 6)} USDC`);

    // ========================================================================
    // STEP 5: Stop Impersonating Whale
    // ========================================================================
    console.log('\nSTEP 5: Stopping whale impersonation...');
    await ethers.provider.send("hardhat_stopImpersonatingAccount", [USDC_WHALE]);
    console.log('Whale impersonation stopped');

    // ========================================================================
    // STEP 6: Summary
    // ========================================================================
    console.log('\n' + '='.repeat(70));
    console.log('SETUP COMPLETE - Summary');
    console.log('='.repeat(70));
    console.log(`Deployer balance: ${ethers.utils.formatUnits(deployerBalanceAfter, 6)} USDC`);
    console.log(`Contract balance: ${ethers.utils.formatUnits(contractBalanceAfter, 6)} USDC`);
    console.log(`Contract address: ${vusdArbitrage.address}`);
    console.log('Ready to run tests...\n');
  });

  // ========================================================================
  // TEST 1: Execute RICH Scenario
  // ========================================================================
  it('should execute RICH scenario with detailed logging', async () => {
    console.log('\n' + '='.repeat(70));
    console.log('TEST 1: RICH SCENARIO');
    console.log('Strategy: USDC → crvUSD → VUSD → USDC (redeem)');
    console.log('='.repeat(70));

    // Small flashloan amount - contract has capital to cover any shortfall
    const flashloanAmount = toUsdc(10);
    console.log(`\nFlashloan amount: ${ethers.utils.formatUnits(flashloanAmount, 6)} USDC`);

    // Check contract balance before executing
    const balanceBefore = await usdcContract.balanceOf(vusdArbitrage.address);
    console.log(`Contract USDC before trade: ${ethers.utils.formatUnits(balanceBefore, 6)} USDC`);

    console.log('\nExecuting RICH scenario...');
    
    try {
      // Execute the RICH path
      const tx = await vusdArbitrage.executeRich(flashloanAmount, { gasLimit: 5000000 });
      const receipt = await tx.wait();
      
      console.log(`\n✅ Transaction succeeded!`);
      console.log(`Transaction hash: ${receipt.transactionHash}`);
      console.log(`Gas used: ${receipt.gasUsed.toString()}`);
      console.log(`Block number: ${receipt.blockNumber}`);
      
      // Check contract balance after executing
      const balanceAfter = await usdcContract.balanceOf(vusdArbitrage.address);
      console.log(`\nContract USDC after trade: ${ethers.utils.formatUnits(balanceAfter, 6)} USDC`);
      
      // Calculate change (could be profit, loss, or neutral depending on market conditions)
      const change = balanceAfter.sub(balanceBefore);
      const changeFormatted = ethers.utils.formatUnits(change, 6);
      const changeSign = change.isNegative() ? '' : '+';
      console.log(`Change: ${changeSign}${changeFormatted} USDC`);
      
      if (change.isNegative()) {
        console.log('Note: Loss expected with current market conditions (price near peg)');
        console.log('Contract has capital buffer to complete the trade cycle');
      }
      
    } catch (error: any) {
      console.log('\n❌ RICH SCENARIO FAILED');
      console.log('Error message:', error.message);
      if (error.reason) {
        console.log('Revert reason:', error.reason);
      }
      if (error.error?.message) {
        console.log('Detailed error:', error.error.message);
      }
      throw error;
    }
  });

  // ========================================================================
  // TEST 2: Execute CHEAP Scenario
  // ========================================================================
  it('should execute CHEAP scenario with detailed logging', async () => {
    console.log('\n' + '='.repeat(70));
    console.log('TEST 2: CHEAP SCENARIO');
    console.log('Strategy: USDC → VUSD (mint) → crvUSD → USDC');
    console.log('='.repeat(70));

    // Small flashloan amount - contract has capital to cover any shortfall
    const flashloanAmount = toUsdc(10);
    console.log(`\nFlashloan amount: ${ethers.utils.formatUnits(flashloanAmount, 6)} USDC`);

    // Check contract balance before executing
    const balanceBefore = await usdcContract.balanceOf(vusdArbitrage.address);
    console.log(`Contract USDC before trade: ${ethers.utils.formatUnits(balanceBefore, 6)} USDC`);

    console.log('\nExecuting CHEAP scenario...');
    
    try {
      // Execute the CHEAP path
      const tx = await vusdArbitrage.executeCheap(flashloanAmount, { gasLimit: 5000000 });
      const receipt = await tx.wait();
      
      console.log(`\n✅ Transaction succeeded!`);
      console.log(`Transaction hash: ${receipt.transactionHash}`);
      console.log(`Gas used: ${receipt.gasUsed.toString()}`);
      console.log(`Block number: ${receipt.blockNumber}`);
      
      // Check contract balance after executing
      const balanceAfter = await usdcContract.balanceOf(vusdArbitrage.address);
      console.log(`\nContract USDC after trade: ${ethers.utils.formatUnits(balanceAfter, 6)} USDC`);
      
      // Calculate change (could be profit, loss, or neutral depending on market conditions)
      const change = balanceAfter.sub(balanceBefore);
      const changeFormatted = ethers.utils.formatUnits(change, 6);
      const changeSign = change.isNegative() ? '' : '+';
      console.log(`Change: ${changeSign}${changeFormatted} USDC`);
      
      if (change.isNegative()) {
        console.log('Note: Loss expected with current market conditions (price near peg)');
        console.log('Contract has capital buffer to complete the trade cycle');
      }
      
    } catch (error: any) {
      console.log('\n❌ CHEAP SCENARIO FAILED');
      console.log('Error message:', error.message);
      if (error.reason) {
        console.log('Revert reason:', error.reason);
      }
      if (error.error?.message) {
        console.log('Detailed error:', error.error.message);
      }
      throw error;
    }
  });

  // ========================================================================
  // TEST 3: Test with Larger Flashloan (1000 USDC)
  // ========================================================================
  it('should execute RICH scenario with 1000 USDC flashloan', async () => {
    console.log('\n' + '='.repeat(70));
    console.log('TEST 3: RICH SCENARIO - LARGER FLASHLOAN');
    console.log('Testing with 1000 USDC to see if larger amounts reduce fees proportionally');
    console.log('='.repeat(70));

    const flashloanAmount = toUsdc(1000);
    console.log(`\nFlashloan amount: ${ethers.utils.formatUnits(flashloanAmount, 6)} USDC`);

    const balanceBefore = await usdcContract.balanceOf(vusdArbitrage.address);
    console.log(`Contract USDC before: ${ethers.utils.formatUnits(balanceBefore, 6)} USDC`);

    try {
      const tx = await vusdArbitrage.executeRich(flashloanAmount, { gasLimit: 5000000 });
      const receipt = await tx.wait();
      
      console.log(`\n✅ Transaction succeeded!`);
      console.log(`Gas used: ${receipt.gasUsed.toString()}`);
      
      const balanceAfter = await usdcContract.balanceOf(vusdArbitrage.address);
      console.log(`Contract USDC after: ${ethers.utils.formatUnits(balanceAfter, 6)} USDC`);
      
      const change = balanceAfter.sub(balanceBefore);
      const changeFormatted = ethers.utils.formatUnits(change, 6);
      const changeSign = change.isNegative() ? '' : '+';
      console.log(`Change: ${changeSign}${changeFormatted} USDC`);
      
    } catch (error: any) {
      console.log('\n❌ Transaction failed');
      console.log('Error:', error.message);
      throw error;
    }
  });
});
