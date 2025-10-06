import { ethers } from 'hardhat';

async function main() {
  const ORACLE_ADDRESS = '0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6'; // USDC/USD
  
  const oracleAbi = [
    'function latestRoundData() external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)'
  ];
  
  const oracle = await ethers.getContractAt(oracleAbi, ORACLE_ADDRESS);
  const latestRound = await oracle.latestRoundData();
  
  const block = await ethers.provider.getBlock('latest');
  const age = block.timestamp - latestRound.updatedAt.toNumber();
  const ageHours = age / 3600;
  
  console.log('Oracle last updated:', new Date(latestRound.updatedAt.toNumber() * 1000));
  console.log('Current block time:', new Date(block.timestamp * 1000));
  console.log('Oracle age:', ageHours.toFixed(2), 'hours');
  console.log('Is stale (>24h)?:', ageHours > 24);
}

main();
