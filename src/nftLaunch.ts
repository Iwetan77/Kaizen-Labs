import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { fromB64 } from '@mysten/sui/utils';
import fs from 'fs/promises';
import path from 'path';
import axios, { AxiosResponse } from 'axios';
import { execSync } from 'child_process';
import { z } from 'zod';
import inquirer from 'inquirer';
import type { Question } from 'inquirer'; // 
// Zod Schemas
const MemeSchema = z.object({
  name: z.string().min(1, "Name cannot be empty"),
  symbol: z.string().regex(/^[A-Z]{3,5}$/, "Must be 3-5 uppercase letters"),
  description: z.string().default("A meme NFT collection"),
  imagePath: z.string().refine(async (val) => {
    try {
      await fs.access(val);
      return true;
    } catch {
      return false;
    }
  }, "File not found"),
  network: z.enum(['mainnet', 'testnet', 'devnet']).default('testnet'),
  totalSupply: z.number().min(1).max(10_000),
  royaltyBps: z.number().min(0).max(100).default(5)
});

type MemeConfig = z.infer<typeof MemeSchema>;

interface WalrusResponse {
  url: string;
}

interface MoveBuildOutput {
  modules: string[];
  dependencies: string[];
}

interface SuiObjectChange {
  type: string;
  objectId?: string;
  packageId?: string;
  objectType?: string;
}

export async function launchMeme(): Promise<void> {
  // ✅ Strictly typed questions
  const questions: Question<MemeConfig>[] = [
    {
      type: 'input',
      name: 'name',
      message: 'Collection name:',
      validate: (input: string) => {
        const result = MemeSchema.shape.name.safeParse(input);
        return result.success || result.error.errors[0].message;
      }
    },
    {
      type: 'input',
      name: 'symbol',
      message: 'Ticker symbol (3-5 chars):',
      validate: (input: string) => {
        const result = MemeSchema.shape.symbol.safeParse(input);
        return result.success || result.error.errors[0].message;
      }
    },
    {
      type: 'input',
      name: 'description',
      message: 'Description:',
      default: MemeSchema.shape.description._def.defaultValue()
    },
    {
      type: 'input',
      name: 'imagePath',
      message: 'Path to meme image:',
      validate: async (input: string) => {
        const result = await MemeSchema.shape.imagePath.safeParseAsync(input);
        return result.success || result.error.errors[0].message;
      }
    },
    {
      type: 'list',
      name: 'network',
      message: 'Network:',
      choices: MemeSchema.shape.network._def.innerType.options,
      default: MemeSchema.shape.network._def.defaultValue()
    },
    {
      type: 'number',
      name: 'totalSupply',
      message: 'Total supply:',
      default: 1000,
      validate: (input: number) => {
        const result = MemeSchema.shape.totalSupply.safeParse(input);
        return result.success || result.error.errors[0].message;
      }
    },
    {
      type: 'number',
      name: 'royaltyBps',
      message: 'Royalty % (0-100):',
      default: MemeSchema.shape.royaltyBps._def.defaultValue(),
      validate: (input: number) => {
        const result = MemeSchema.shape.royaltyBps.safeParse(input);
        return result.success || result.error.errors[0].message;
      }
    }
  ];

  // ✅ Prompt + Validation
  const rawAnswers = await inquirer.prompt(questions);
  const answers = await MemeSchema.parseAsync(rawAnswers);

  // ✅ Create Project Folder
  const projectDir: string = path.join(process.cwd(), `meme-${answers.symbol.toLowerCase()}`);
  await fs.mkdir(projectDir, { recursive: true });
  
  console.log('🚀 Initializing Sui NFT project...');

  // ✅ Upload Image to Walrus
  console.log('📤 Uploading meme to Walrus...');
  const imageUrl: string = await uploadToWalrus(answers.imagePath);

  // ✅ Generate Move Files
  await generateMoveFiles(projectDir, {
    ...answers,
    imageUrl
  });

  // ✅ Build Move Package
  console.log('🏗 Building Move package...');
  execSync('sui move build', { 
    stdio: 'inherit', 
    cwd: projectDir 
  });

  // ✅ Deploy
  console.log('🛰 Deploying to Sui...');
  await deployCollection(projectDir, answers.network);

  console.log(`\n🎉 Meme NFT launched successfully!`);
  console.log(`👉 Project directory: ${projectDir}`);
}

// --- Helpers ---

async function uploadToWalrus(filePath: string): Promise<string> {
  const data: Buffer = await fs.readFile(filePath);
  const res: AxiosResponse<WalrusResponse> = await axios.post(
    'https://api.walrus.gg/upload', 
    data,
    {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Authorization': `Bearer ${process.env.WALRUS_API_KEY}`
      }
    }
  );
  return res.data.url;
}

async function generateMoveFiles(
  projectDir: string, 
  config: MemeConfig & { imageUrl: string }
): Promise<void> {
  await fs.mkdir(path.join(projectDir, 'sources'), { recursive: true });
  
  await fs.writeFile(
    path.join(projectDir, 'Move.toml'),
    `[package]
name = "meme_${config.symbol.toLowerCase()}"
version = "0.1.0"

[dependencies]
Sui = { git = "https://github.com/MystenLabs/sui.git", subdir = "crates/sui-framework/packages/sui-framework", rev = "framework/testnet" }`
  );

  await fs.writeFile(
    path.join(projectDir, 'sources', 'meme.move'),
    generateMoveCode(config)
  );
}

function generateMoveCode(config: MemeConfig & { imageUrl: string }): string {
  return `module meme_${config.symbol.toLowerCase()}::meme {
    use sui::transfer;
    use sui::object::{Self, UID};
    use sui::tx_context::TxContext;
    use sui::display;
    use sui::url::Url;
    use sui::string::String;

    struct ${config.symbol} has key, store {
        id: UID,
        name: String,
        description: String,
        image_url: Url,
    }

    public fun init(otw: &mut TxContext) {
        let display = display::new_with_fields(
            &mut display::new(),
            vector[
                ("name", "${config.name}"),
                ("description", "${config.description}"),
                ("image_url", "${config.imageUrl}"),
                ("creator", "Meme Creator"),
                ("royalty", "${config.royaltyBps}"),
                ("symbol", "${config.symbol}")
            ]
        );
        display::update_version(&mut display);
        transfer::public_transfer(display, tx_context::sender(otw));
    }

    public entry fun mint(
        name: String,
        description: String,
        image_url: Url,
        recipient: address,
        ctx: &mut TxContext
    ) {
        let meme = ${config.symbol} {
            id: object::new(ctx),
            name,
            description,
            image_url
        };
        transfer::public_transfer(meme, recipient);
    }
}`;
}

async function deployCollection(projectDir: string, network: string): Promise<void> {
  const client = new SuiClient({ url: getFullnodeUrl(network as 'mainnet' | 'testnet' | 'devnet' | 'localnet') });
  const keypair = getKeypair();

  const buildOutput: MoveBuildOutput = JSON.parse(
    execSync('sui move build --dump-bytecode-as-base64', {
      encoding: 'utf-8',
      cwd: projectDir
    })
  );

  const txb = new Transaction();
  const [upgradeCap] = txb.publish({
    modules: buildOutput.modules,
    dependencies: buildOutput.dependencies
  });
  txb.transferObjects([upgradeCap], txb.pure(new TextEncoder().encode(keypair.getPublicKey().toSuiAddress())));

  const result = await client.signAndExecuteTransaction({
    transaction: txb,
    signer: keypair,
    options: { 
      showEffects: true, 
      showObjectChanges: true 
    }
  });

  const publishedPackage = result.objectChanges?.find(
    (change: SuiObjectChange) => change.type === 'published' && 'packageId' in change
  );

  console.log(`📦 Package ID: ${publishedPackage ? (publishedPackage as { packageId: string }).packageId : 'Unknown'}`);
  console.log(`🔗 Explorer: https://suiexplorer.com/txblock/${result.digest}?network=${network}`);
}

function getKeypair(): Ed25519Keypair {
  if (!process.env.SUI_PRIVATE_KEY) {
    throw new Error('Missing SUI_PRIVATE_KEY in environment');
  }
  return Ed25519Keypair.fromSecretKey(fromB64(process.env.SUI_PRIVATE_KEY).slice(1));
}
