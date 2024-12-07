import { Injectable, Signal, computed, signal } from '@angular/core';
import { LAMPORTS_PER_SOL, PublicKey, StakeProgram, Transaction } from '@solana/web3.js';
import { 
  ApiService, 
  JupStoreService, 
  PortfolioFetchService, 
  PortfolioService, 
  SolanaHelpersService, 
  ToasterService, 
  TxInterceptorService, 
  UtilService 
} from 'src/app/services';
import { OutOfRange, StashAsset, StashGroup, TokenInfo } from './stash.model';
import { NftsService } from 'src/app/services/nfts.service';
import { burnChecked, createBurnCheckedInstruction } from "../../../../node_modules/@solana/spl-token";


@Injectable({
  providedIn: 'root'
})
export class StashService {
  private outOfRangeDeFiPositionsSignal = signal<StashGroup | null>(null);
  private zeroValueAssetsSignal = signal<any>(null);

  constructor(
    private _nftService: NftsService,
    private _utils: UtilService,
    private _jupStoreService: JupStoreService,
    private _shs: SolanaHelpersService,
    private _apiService: ApiService,
    private _txi: TxInterceptorService,
    private _portfolioService: PortfolioService,
    private _portfolioFetchService: PortfolioFetchService,
    private _toasterService: ToasterService
  ) {
    this.initializeService();
  }

  private initializeService() {
    this.updateOutOfRangeDeFiPositions();
    this.updateZeroValueAssets();
  }

  private createStashGroup(
    label: string, 
    description: string, 
    actionTitle: string, 
    assets: StashAsset[]
  ): StashGroup {
    const group: StashGroup = {
      label,
      description,
      actionTitle,
      value: 0,
      data: { assets }
    };
    
    group.value = assets.reduce((acc, curr) => 
      acc + (curr.value || curr.extractedValue?.SOL * this._jupStoreService.solPrice() || 0), 0);
    return group;
  }

  private mapToStashAsset(
    item: any, 
    category: 'nft' | 'token' | 'stake' | 'defi',
    extraData: Record<string, any> = {}
  ): StashAsset {

    const baseAsset = {
      name: item.name,
      symbol: item.symbol,
      imgUrl: item.imgUrl,
      mint: item.mint,
      decimals: item?.decimals,
      account: this._utils.addrUtil(item['address'] || 'default'),
      action: this.getActionByCategory(category),
      type: this.getTypeByCategory(category),
      source: this.getSourceByCategory(category),
      ...extraData
    };

    switch (category) {
      case 'defi':
        return {
          ...baseAsset,
          name: item.poolPair,
          symbol: item.poolPair,
          imgUrl: [item.poolTokenA.imgUrl, item.poolTokenB.imgUrl],
          tokens: [item.poolTokenA, item.poolTokenB].map(this.mapToTokenInfo),
          platform: item.platform,
          platformImgUrl: item.platformImgUrl,
          value: item.pooledAmountAWithRewardsUSDValue + item.pooledAmountBWithRewardsUSDValue,
          extractedValue: {
            [item.poolTokenA.symbol]: Number(item.pooledAmountAWithRewards),
            [item.poolTokenB.symbol]: Number(item.pooledAmountBWithRewards)
          },
          positionData: item.positionData
        };
      case 'stake':
        return {
          ...baseAsset,
          extractedValue: { SOL: item.excessLamport / LAMPORTS_PER_SOL }
        };
      default:
        return {
          ...baseAsset,
          extractedValue: { SOL: 0.02 }
        };
    }
  }

  private mapToTokenInfo(token: any): TokenInfo {
    return {
      address: token.address,
      decimals: token.decimals,
      symbol: token.symbol,
      imgUrl: token.imgUrl || token.imgURL
    };
  }

  private getActionByCategory(category: string): string {
    const actions = {
      defi: 'Withdraw & Close',
      stake: 'harvest',
      default: 'burn'
    };
    return actions[category] || actions.default;
  }

  private getTypeByCategory(category: string): string {
    const types = {
      nft: 'nft',
      defi: 'defi-position',
      stake: 'stake-account',
      default: 'empty-account'
    };
    return types[category] || types.default;
  }

  private getSourceByCategory(category: string): string {
    const sources = {
      defi: 'out of range',
      stake: 'excess balance',
      default: 'no market value'
    };
    return sources[category] || sources.default;
  }

  public findZeroValueAssets = computed(() => {
    const NFTs = this._portfolioService.nfts();
    const tokens = this._portfolioService.tokens();
    const additionalAssets = this.zeroValueAssetsSignal();
    
    if (!NFTs || !tokens || !additionalAssets) return null;
    console.log(NFTs, tokens, additionalAssets);
    const filterNftZeroValue = NFTs
      ?.filter(acc => acc.floorPrice < 0.01 && acc.floorPrice === 0)
      .filter(token => !token.name.includes('Orca Whirlpool Position') 
        && !token.name.includes('Raydium Concentrated Liquidity'))
      .map(nft => this.mapToStashAsset(nft, 'nft'));

    const filterTokenZeroValue = tokens
      .filter(acc => Number(acc.value) < 1);
    // add simiar filter to additionalAssets
    // const additionalZeroValueTokens = additionalAssets
    //   .filter(acc => Number(acc.value) < 1);
    // Combine tokens and additional assets before mapping
    const allTokens = [...filterTokenZeroValue, ...additionalAssets];
    console.log('allTokens', allTokens);
    // Create a Map to merge duplicates based on address
    const mergedTokensMap = new Map();
    allTokens.forEach(token => {
      console.log(token);
      
      const address = token.address;
      if (mergedTokensMap.has(address)) {
        const existing = mergedTokensMap.get(address);

        mergedTokensMap.set(address, {
          ...existing,
          mint: (!existing.mint && token.mint) ? token.mint : existing.mint,
          name: (!existing.name && token.name) ? token.name : existing.name,
          symbol: (!existing.symbol && token.symbol) ? token.symbol : existing.symbol,
          imgUrl: (!existing.imgUrl && token.imgUrl) ? token.imgUrl : existing.imgUrl,
          decimals: (!existing.decimals && token.decimals) ? token.decimals : existing.decimals,
          balance: (!existing.balance && token.balance) ? token.balance : existing.balance,
        });
        console.log(mergedTokensMap.get(address));
        
      } else {
        mergedTokensMap.set(address, token);
      }
    });

    // Combine unique tokens with NFTs
    const allAssets = [...filterNftZeroValue, ...Array.from(mergedTokensMap.values())];
    console.log(allAssets);
    
    return this.createStashGroup(
      'zero value assets',
      "This dataset includes NFTs and tokens that are not used and sit idle ready to be withdrawal.",
      "burn",
      allAssets
    );
  });

  public findStakeOverflow = computed(() => {
    const accounts = this._portfolioService.staking();
    if (!accounts) return null;

    const filterExceedBalance = accounts
      .filter(acc => acc.state === 'active' && acc.excessLamport && !acc.locked)
      .map(acc => this.mapToStashAsset(acc, 'stake'));

    return this.createStashGroup(
      'Unstaked overflow',
      "Excess balance from your stake account mostly driven by MEV rewards that are not compounded.",
      "harvest",
      filterExceedBalance
    );
  });

  public findOutOfRangeDeFiPositions = computed(() => {
    return this.outOfRangeDeFiPositionsSignal();
  });

  public async getOutOfRangeDeFiPositions(): Promise<OutOfRange[]> {
    const { publicKey } = this._shs.getCurrentWallet()
    try {
      const getOutOfRange: OutOfRange[] = await (await fetch(`${this._utils.serverlessAPI}/api/stash/out-of-range?address=${publicKey.toBase58()}`)).json()
      // console.log(getOutOfRange);

      return getOutOfRange
    } catch (error) {
      return null
    }
  }

  public async getZeroValueAssets() {
    const { publicKey } = this._shs.getCurrentWallet()
    try {
      const unknownAssets = await this._shs.getTokenAccountsBalance(publicKey.toBase58(), true, false, 'token')
      return unknownAssets
    } catch (error) {
      return null
    }
  }

  async withdrawStakeAccountExcessBalance(accounts: StashAsset[]) {
    const { publicKey } = this._shs.getCurrentWallet()
    const withdrawTx = accounts.map(acc => StakeProgram.withdraw({
      stakePubkey: new PublicKey(acc.account.addr),
      authorizedPubkey: publicKey,
      toPubkey: publicKey,
      lamports: acc.extractedValue.SOL * LAMPORTS_PER_SOL, // Withdraw the full balance at the time of the transaction
    }));
    this
    this._txi.sendTx(withdrawTx, publicKey).then(res => {
    if(res) {
      this._portfolioFetchService.refetchPortfolio()
    }
  })
  
    
    // this._nss.withdraw([account], publicKey, account.extractedValue.SOL * LAMPORTS_PER_SOL)
  }

  async closeOutOfRangeDeFiPosition(positions?: StashAsset[]) {
    try {
      const walletOwner = this._shs.getCurrentWallet().publicKey
      const positionsToClose = positions.filter(p => p.type === 'defi-position')
      const positionsData = positionsToClose.map(p => {
        return {
          ...p.positionData,
          platform: p.platform
        }
      })
      // get remove liquidity tx instructions
      const encodedIx  = await (await fetch(`${this._utils.serverlessAPI}/api/stash/close-positions`, {
        method: 'POST',
        body: JSON.stringify({ wallet: walletOwner.toBase58(), positions: positionsData })
      })).json()
      const txInsArray: Transaction[] = encodedIx.map(ix => Transaction.from(Buffer.from(ix, 'base64')))
       this._txi.sendMultipleTxn(txInsArray).then(res => {
        if(res) {
          this.updateOutOfRangeDeFiPositions()
        }
      })
      
    } catch (error) {
      console.log(error);
      return null
    }
  }

  private async updateOutOfRangeDeFiPositions() {
    const positions = await this.getOutOfRangeDeFiPositions();
    if (!positions) {
      this.outOfRangeDeFiPositionsSignal.set(null);
      return;
    }
    
    const stashGroup: StashGroup = {
      label: 'zero yield zones',
      description: "This dataset includes open positions in DeFi protocols that are not used and sit idle ready to be withdrawal.",
      actionTitle: "Withdraw & Close",
      value: 0,
      data: {
        assets: positions.map(p => ({
          name: p.poolPair,
          symbol: p.poolPair,
          imgUrl: [p.poolTokenA.imgUrl, p.poolTokenB.imgUrl],
          tokens: [p.poolTokenA, p.poolTokenB].map(token => ({
            address: token.address,
            decimals: token.decimals,
            symbol: token.symbol,
            imgUrl: token.imgUrl
          })),
          account: this._utils.addrUtil('awdawaxaxjnawjan23424asndwadawd'),
          source: 'out of range',
          platform: p.platform,
          platformImgUrl: p.platformImgUrl,
          extractedValue: {
            [p.poolTokenA.symbol]: Number(p.pooledAmountAWithRewards),
            [p.poolTokenB.symbol]: Number(p.pooledAmountBWithRewards)
          },
          action: 'Withdraw & Close',
          type: 'defi-position',
          value: p.pooledAmountAWithRewardsUSDValue + p.pooledAmountBWithRewardsUSDValue,
          positionData: p.positionData
        }))
      }
    };
    stashGroup.value = stashGroup.data.assets.reduce((acc, curr) => acc + (curr.value || 0), 0);
    this.outOfRangeDeFiPositionsSignal.set(stashGroup);
  }

  async updateZeroValueAssets() {
    const zeroValueAssets = await this.getZeroValueAssets();
    if (zeroValueAssets) {
      this.zeroValueAssetsSignal.set(zeroValueAssets);
    }
  }

  public async burnAccounts(accounts: StashAsset[]) {
    const { publicKey } = this._shs.getCurrentWallet()

    const nftsAddress = accounts.filter(acc => acc.type === 'nft').map(acc => (acc).account.addr)
    console.log(nftsAddress,accounts);
    
    // const burnNftTx = await this._nftService.burnNft(nftsAddress, publicKey.toBase58())
    const burnTokenTx = await Promise.all(accounts.filter(acc => acc.type === 'token').map(async acc => {
      let tx = new Transaction().add(
        createBurnCheckedInstruction(
          new PublicKey(acc.account.addr), // token account
          new PublicKey(acc.mint), // mint
          publicKey, // owner of token account
          acc.balance, // amount, if your deciamls is 8, 10^8 for 1 token
          acc.decimals, // decimals
        ),
      );
      return tx
    }))
    console.log(burnTokenTx);
    await this._txi.sendMultipleTxn([...burnTokenTx])
  }
}
