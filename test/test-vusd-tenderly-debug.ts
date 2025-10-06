// test/test-vusd-tenderly-debug.ts
import { ethers } from 'hardhat';
import { expect } from 'chai';
import { VusdArbitrage } from '../typechain-types';
import { VusdArbitrage__factory } from '../typechain-types/factories/contracts/VusdArbitrage.sol';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { Contract } from 'ethers';

const toUsdc = (amount: number | string) => ethers.utils.parseUnits(amount.toString(), 6);

describe('VusdArbitrage Tenderly Fork Test (Debug)', () => {
  let vusdArbitrage: VusdArbitrage;
  let deployer: SignerWithAddress;
  let usdcContract: Contract;

  const USDC_ADDRESS = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
  const CRVUSD_ADDRESS = '0xf939E0A03FB07F59A73314E73794Be0E57ac1b4E';
  const VUSD_ADDRESS = '0x677ddbd918637E5F2c79e164D402454dE7dA8619';
  const VUSD_MINTER = '0x3C8aeF08d90C2418f8AE887af47ba7d8Db88AF6b';
  const VUSD_REDEEMER = '0x43c704BC0F773B529E871EAAF4E283C2233512F9';
  const CURVE_CRVUSD_USDC_POOL = '0x4DEcE678ceceb27446b35C672dC7d61F30bAD69E';
  const CURVE_CRVUSD_VUSD_POOL = '0xB1c189dfDe178FE9F90E72727837cC9289fB944F';
  const UNISWAP_V3_USDC_POOL = '0x919b20Ac45304AEB09C9df5c604b3CD9D99a51cA';

  const CRVUSD_USDC_POOL_USDC_INDEX = 0;
  const CRVUSD_USDC_POOL_CRVUSD_INDEX = 1;
  const CRVUSD_VUSD_POOL_CRVUSD_INDEX = 0;
  const CRVUSD_VUSD_POOL_VUSD_INDEX = 1;

  before(async () => {
    [deployer] = await ethers.getSigners();

    console.log('Deploying VusdArbitrage contract on forked mainnet...');
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

    usdcContract = await ethers.getContractAt('IERC20', USDC_ADDRESS);
  });

  it('should execute RICH scenario and show detailed error if it fails', async () => {
    const flashloanAmount = toUsdc(100);

    const balanceBefore = await usdcContract.balanceOf(vusdArbitrage.address);
    console.log(`USDC balance before RICH tx: ${ethers.utils.formatUnits(balanceBefore, 6)}`);

    console.log('Executing RICH scenario...');
    
    try {
      const tx = await vusdArbitrage.executeRich(flashloanAmount, { gasLimit: 5000000 });
      const receipt = await tx.wait();
      
      console.log(`✅ Transaction succeeded!`);
      console.log(`Gas used: ${receipt.gasUsed.toString()}`);
      
      const balanceAfter = await usdcContract.balanceOf(vusdArbitrage.address);
      console.log(`USDC balance after: ${ethers.utils.formatUnits(balanceAfter, 6)}`);
      
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

  it('should execute CHEAP scenario and show detailed error if it fails', async () => {
    const profitFromRich = await usdcContract.balanceOf(vusdArbitrage.address);
    if (profitFromRich.gt(0)) {
      await vusdArbitrage.emergencyWithdraw(USDC_ADDRESS);
    }

    const flashloanAmount = toUsdc(100);

    const balanceBefore = await usdcContract.balanceOf(vusdArbitrage.address);
    console.log(`\nUSDC balance before CHEAP tx: ${ethers.utils.formatUnits(balanceBefore, 6)}`);

    console.log('Executing CHEAP scenario...');
    
    try {
      const tx = await vusdArbitrage.executeCheap(flashloanAmount, { gasLimit: 5000000 });
      const receipt = await tx.wait();
      
      console.log(`✅ Transaction succeeded!`);
      console.log(`Gas used: ${receipt.gasUsed.toString()}`);
      
      const balanceAfter = await usdcContract.balanceOf(vusdArbitrage.address);
      console.log(`USDC balance after: ${ethers.utils.formatUnits(balanceAfter, 6)}`);
      
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
});
