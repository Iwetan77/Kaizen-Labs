#!/usr/bin/env node
import { program, Command } from 'commander';
import chalk from 'chalk';
import { SuiClient, getFullnodeUrl, SuiObjectResponse } from '@mysten/sui/client';
import axios, { AxiosResponse } from 'axios';

interface NftMetadata {
  creator?: string;
  type?: string;
  tag?: string;
  allTimeFloorPrice?: string;
  name?: string;
  description?: string;
  imageUrl?: string;
  attributes?: Record<string, string>;
}

interface MarketplaceApiResponse {
  allTimeFloorPrice?: string;
}

async function getNftDetails(nftObjectId: string): Promise<void> {
  const client: SuiClient = new SuiClient({ url: getFullnodeUrl('mainnet') });

  console.log(chalk.yellow(`\nFetching details for NFT: ${nftObjectId}...`));

  const nftObject: SuiObjectResponse = await client.getObject({
    id: nftObjectId,
    options: {
      showContent: true,
      showDisplay: true,
      showType: true,
    },
  });

  if (!nftObject.data) {
    throw new Error('NFT not found or data unavailable');
  }

  const nftType: string | undefined = nftObject.data.type ?? undefined;
  const display: Record<string, string> | undefined = nftObject.data.display?.data ?? undefined;
  const content: any = nftObject.data.content;

  const metadata: NftMetadata = {
    type: nftType,
  };

  if (display) {
    metadata.name = display.name;
    metadata.description = display.description;
    metadata.imageUrl = display.image_url;
    metadata.creator = display.creator;
    metadata.tag = display.tag;
  }

  if (content && 'fields' in content) {
    const fields: Record<string, any> = content.fields;
    metadata.attributes = {} as Record<string, string>;

    for (const [key, value] of Object.entries(fields)) {
      if (!key.startsWith('_')) {
        metadata.attributes[key] = typeof value === 'object' 
          ? JSON.stringify(value) 
          : String(value);
      }
    }
  }

  try {
    const response: AxiosResponse<MarketplaceApiResponse> = await axios.get(
      `https://api.suimarketplace.com/nfts/${nftObjectId}/stats`
    );
    metadata.allTimeFloorPrice = response.data.allTimeFloorPrice;
  } catch (error: unknown) {
    if (error instanceof Error) {
      console.log(chalk.gray(`Could not fetch floor price data: ${error.message}`));
    } else {
      console.log(chalk.gray('Could not fetch floor price data'));
    }
  }

  // Corrected chalk usage - using the instance directly
  console.log(chalk.green('\nNFT Details:'));
  console.log(chalk.cyan('----------------------------------'));
  console.log(chalk.whiteBright(`Name: ${metadata.name || 'Not available'}`));
  console.log(chalk.whiteBright(`Type: ${metadata.type || 'Not available'}`));
  console.log(chalk.whiteBright(`Creator: ${metadata.creator || 'Not available'}`));
  console.log(chalk.whiteBright(`Tag: ${metadata.tag || 'Not available'}`));
  console.log(chalk.whiteBright(`All Time Floor Price: ${metadata.allTimeFloorPrice || 'Not available'}`));
  
  if (metadata.description) {
    console.log(chalk.whiteBright(`\nDescription: ${metadata.description}`));
  }

  if (metadata.imageUrl) {
    console.log(chalk.whiteBright(`\nImage URL: ${metadata.imageUrl}`));
  }

  if (metadata.attributes && Object.keys(metadata.attributes).length > 0) {
    console.log(chalk.magenta('\nAttributes:'));
    for (const [key, value] of Object.entries(metadata.attributes)) {
      console.log(chalk.white(`  ${key}: ${value}`));
    }
  }

  console.log(chalk.cyan('----------------------------------\n'));
}

const cli: Command = program
  .name('kaizen')
  .description(chalk.blueBright('CLI tool for SUI blockchain NFT details'))
  .version('1.0.0');

cli.command('getNftDetails <nftObjectId>')
  .description('Get detailed metadata for an SUI NFT')
  .action(async (nftObjectId: string) => {
    try {
      await getNftDetails(nftObjectId);
    } catch (error: unknown) {
      const errorMessage: string = error instanceof Error ? error.message : 'Unknown error';
      console.error(chalk.red('Error:'), errorMessage);
      process.exit(1);
    }
  });

cli.parse(process.argv);