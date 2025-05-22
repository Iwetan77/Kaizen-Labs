#!/usr/bin/env node

import { Command } from 'commander';
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import axios from 'axios';
import chalk from 'chalk';
import ora from 'ora';

// Define types
type NetworkName = 'mainnet' | 'testnet' | 'devnet' | 'localnet';

interface NetworkConfig {
  url: string;
  suiNsEndpoint: string;
  chainId: string;
}

interface NetworkConfigs {
  mainnet: NetworkConfig;
  testnet: NetworkConfig;
  devnet: NetworkConfig;
  localnet: NetworkConfig;
}

interface Balance {
  coinType: string;
  totalBalance: string;
}

interface SuiNameResponse {
  address?: string;
  name?: string;
}

// Network configuration
const NETWORKS: NetworkConfigs = {
  mainnet: {
    url: getFullnodeUrl('mainnet'),
    suiNsEndpoint: 'https://api.suins.io/mainnet',
    chainId: '0x1'
  },
  testnet: {
    url: getFullnodeUrl('testnet'),
    suiNsEndpoint: 'https://api.suins.io/testnet',
    chainId: '0x2'
  },
  devnet: {
    url: getFullnodeUrl('devnet'),
    suiNsEndpoint: 'https://api.suins.io/devnet',
    chainId: '0x3'
  },
  localnet: {
    url: 'http://127.0.0.1:9000',
    suiNsEndpoint: 'http://localhost:3000/api',
    chainId: '0x4'
  }
};

const program = new Command();
program
  .name('kaizen')
  .description('A smart Sui blockchain CLI that auto-detects networks')
  .version('1.0.0');

program
  .command('getAccountInfo')
  .description('Get account information (auto-detects network)')
  .argument('<identifier>', 'Sui address or SuiNS name')
  .action(async (identifier: string) => {
    const spinner = ora('Detecting account information...').start();
    
    try {
      let address = identifier;
      let isSuiNsName = false;
      
      if (identifier.includes('.sui')) {
        isSuiNsName = true;
        spinner.text = `Resolving SuiNS name: ${identifier}`;
        address = await resolveSuiNameOnAllNetworks(identifier);
        spinner.text = `Resolved ${identifier} to ${address}`;
      }

      const { network, client } = await detectNetworkForAddress(address);
      spinner.text = `Found account on ${network} network`;
      
      const [accountInfo, balances, reverseLookup] = await Promise.all([
        client.getObject({
          id: address,
          options: { showContent: true, showDisplay: true, showOwner: true }
        }),
        client.getAllBalances({ owner: address }),
        isSuiNsName ? Promise.resolve(identifier) : checkForSuiNsName(address, network)
      ]);

      spinner.succeed(`Account information retrieved for ${address}`);

      // Display results
      console.log('\n' + chalk.bold.blue('Network:'), chalk.green(network));
      console.log(chalk.bold('Address:'), address);
      if (reverseLookup) {
        console.log(chalk.bold('SuiNS Name:'), reverseLookup);
      }

      console.log('\n' + chalk.bold.blue('Balances:'));
      if (balances.length === 0) {
        console.log('No coins found');
      } else {
        balances.forEach((b: Balance) => 
          console.log(`${chalk.bold(b.coinType)}: ${b.totalBalance}`)
        );
      }

      console.log('\n' + chalk.bold.blue('Account Object:'));
      console.log(JSON.stringify(accountInfo, null, 2));

    } catch (error: unknown) {
      spinner.fail(chalk.red(error instanceof Error ? error.message : 'Unknown error'));
      process.exit(1);
    }
  });

async function detectNetworkForAddress(address: string): Promise<{
  network: NetworkName;
  client: SuiClient;
}> {
  const networksToCheck: NetworkName[] = ['mainnet', 'testnet', 'devnet'];
  
  for (const network of networksToCheck) {
    try {
      const client = new SuiClient({ url: NETWORKS[network].url });
      const balances = await client.getAllBalances({ owner: address });
      if (balances.length > 0) {
        return { network, client };
      }
    } catch (error) {
      console.debug(`Network ${network} check failed:`, error instanceof Error ? error.message : error);
      continue;
    }
  }
  
  throw new Error('Address not found on any supported network');
}

async function resolveSuiNameOnAllNetworks(name: string): Promise<string> {
  const networksWithSuiNS = Object.keys(NETWORKS) as NetworkName[];
  
  for (const network of networksWithSuiNS) {
    try {
      const address = await resolveSuiName(name, network);
      if (address) return address;
    } catch (error) {
      console.debug(`SuiNS resolution failed on ${network}:`, error instanceof Error ? error.message : error);
      continue;
    }
  }
  throw new Error(`SuiNS name "${name}" not found on any network`);
}

async function checkForSuiNsName(address: string, network: NetworkName): Promise<string | null> {
  try {
    const response = await axios.get<SuiNameResponse>(
      `${NETWORKS[network].suiNsEndpoint}/reverse-lookup?address=${address}`
    );
    return response.data?.name || null;
  } catch (error) {
    console.debug(`Reverse lookup failed:`, error instanceof Error ? error.message : error);
    return null;
  }
}

async function resolveSuiName(name: string, network: NetworkName): Promise<string> {
  try {
    const response = await axios.get<SuiNameResponse>(
      `${NETWORKS[network].suiNsEndpoint}/resolve?name=${encodeURIComponent(name)}`
    );
    if (!response.data?.address) {
      throw new Error('No address returned');
    }
    return response.data.address;
  } catch (error) {
    throw new Error(`Failed to resolve name: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

program.parse(process.argv);

if (!process.argv.slice(2).length) {
  program.help();
}