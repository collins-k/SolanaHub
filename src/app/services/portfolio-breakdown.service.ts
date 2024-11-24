import { computed, effect, inject, Injectable, Signal, signal } from "@angular/core";
import { JupStoreService } from "./jup-store.service";
import { PortfolioService } from "./portfolio.service";
import { NFT, NftTable, WalletEntry } from "../models";

@Injectable({
  providedIn: 'root'
})
export class PortfolioBreakdownService {
  public readonly _jupStore = inject(JupStoreService)
  public readonly _portfolioService = inject(PortfolioService)
  private readonly excludedAssets = signal<Set<string>>(new Set());
  public readonly solPrice = this._jupStore.solPrice;

  constructor() {
    effect(() => {
      console.log("Enabled Portfolio", this.getEnabledPortfolio())
    });
  }

  /**
   * Gets an array of assets from enabled wallets.
   *
   * @type {Signal<any[]>}
   * @readonly
   * @description
   * This computed property returns a Signal that contains an array of assets
   * from wallets that have their portfolio enabled.
   *
   * @returns {Signal<any[]>} A Signal representing an array of assets from enabled wallets.
   */
  public getEnabledWalletsAssets: Signal<any[]> = computed(() => {
    return this.getEnabledPortfolio()
      .map(({ portfolio}) => portfolio.walletAssets)
      .flat()
  });

  /**
   * Groups / Merge token data by address.
   *
   * @returns an array of grouped token data objects.
   *
   * @remarks
   * This method processes an array of wallet data and groups tokens by address.
   * It aggregates balances and values across all wallets for each unique token address.
   * The resulting data structure includes aggregated values, balances, and a breakdown of contributing wallets.
   */
  public getTokensBreakdown: Signal<any[]> =  computed(() => {
    const assets = this.getEnabledPortfolio();
    if (!assets) return [];

    const tokenMap = new Map();
    assets.forEach(wallet => {
      const { walletAddress, portfolio } = wallet
      const { tokens } = portfolio

      tokens.forEach(token => {
        const { address, value, balance } = token;
        let newBalance = balance;
        let newValue = value;

        if (!tokenMap.has(address)) {
          tokenMap.set(address, {
            ...token,
            breakdown: []
          });
          newBalance = 0;
          newValue = 0;
        }

        const existingToken = tokenMap.get(address);
        existingToken.value += newValue;
        existingToken.balance += newBalance;
        existingToken.breakdown.push({
          walletAddress,
          value
        });
      });
    });

    return Array.from(tokenMap.values());
  })


  /**
   * Computed property that returns a breakdown of NFT collections across enabled portfolios.
   *
   * @returns {any[]} Array of NFT collections with their total value, count, and per-wallet value distribution.
   *
   * Each object in the returned array represents an NFT collection and has the following structure:
   * @example
   * [
   *   {
   *     collectionName: "Mad Labs",
   *     count: 3,
   *     value: 100.5,
   *     nfts: [...],
   *     breakdown: Map("wallet1" => 60.5, "wallet2" => 40.0)
   *   }
   * ]
   */
  public getNFTsBreakdown: Signal<any[]> = computed(() => {
    const assets = this.getEnabledPortfolio();
    if (!assets) return [];
    const nftCollectionMap = new Map();

    assets.forEach(wallet => {
      const { walletAddress, portfolio } = wallet

      const nftsData = this.nftDataAggregator(portfolio.nfts);

      nftsData.forEach(data => {
        const { collectionName, value } = data;
        const { nfts, ...rest } = data;

        if (!nftCollectionMap.has(collectionName)) {
          nftCollectionMap.set(collectionName, {
            ...rest,
            count: 0,
            value: 0,
            breakdown: new Map<string, number>()
          });
        }

        const existingToken = { ...nftCollectionMap.get(collectionName) };
        const currentBreakdown = existingToken.breakdown;

        nftCollectionMap.set(collectionName, {
          ...existingToken,
          nfts: [ ...(existingToken.nfts || []), ...nfts],
          count: existingToken.count + 1,
          value: existingToken.value + value,
          breakdown: currentBreakdown.set(walletAddress,( currentBreakdown.get(walletAddress) || 0) + value)
        })
      });
    });

    return Array.from(nftCollectionMap.values())
  })

  /**
   * Aggregates NFT data into collections based on their names.
   *
   * This method processes an array of NFT objects and groups them by collection name.
   * It calculates aggregate values such as total value, count of listed tokens, and minimum floor price.
   *
   * @param {NFT[]} nfts - An array of NFT objects to process.
   * @returns {NftTable[]} An array of aggregated collection data.
   */
  private nftDataAggregator(nfts: NFT[]): NftTable[] {
    if (nfts == null)
      return [];

    const nftMap = new Map<string, any>()

    const collections = nfts.reduce((acc, nft) => {
      const collectionName = nft.collection.name || nft.collectionMagicEdenStatSymbol?.replace(/_/g, ' ') || 'unknown';
      const collectionSymbol = nft.collection.symbol || nft.collectionMagicEdenStatSymbol || '';
      let existingCollection = nftMap.get(collectionName.toLowerCase());

      if (existingCollection) {
        existingCollection.nfts.push(nft);
        existingCollection.value +=  (Number(nft.floorPrice) || 0) * this.solPrice();
        existingCollection.listed += nft.listStatus === "listed" ? 1 : 0;
        existingCollection.floorPrice = Math.min(existingCollection.floorPrice, Number(nft.floorPrice) || Infinity);
      } else {
        existingCollection = {
          collectionName,
          collectionSymbol,
          // collectionKey,
          nfts: [nft],
          value: (Number(nft.floorPrice) || 0) * this.solPrice(),
          imageUri: nft.collection.image_uri,
          listed: nft.listStatus === "listed" ? 1 : 0,
          floorPrice: Number(nft.floorPrice) || 0
        }
        acc.push(existingCollection);
      }
      nftMap.set(collectionName?.toLowerCase(), existingCollection);

      return acc;
    }, []);

    const mergedCollections = collections.map(({collectionSymbol, collectionKey, ...rest}) => rest);
    return mergedCollections.sort((a, b) => b.value - a.value);
  }

  /**
   * Gets the total portfolio value in USD.
   *
   * @type {Signal<number>}
   * @readonly
   * @description
   * This computed property returns a Signal that represents the total portfolio value
   * in USD. It calculates this by summing up the values of all enabled assets
   * in the portfolio, excluding those marked for exclusion.
   *
   * @returns {Signal<number>} A Signal representing the total portfolio value in USD.
   */
  public portfolioTotalUsdValue: Signal<number> = computed(() => {
    const assets = this.getEnabledWalletsAssets();
    if (!assets) return 0;

    return assets
      .filter(data => data?.value && !this.excludedAssets().has(data?.label))
      .reduce((accumulator, currentValue) => accumulator + currentValue.value, 0);
  });

  /**
   * Gets the total portfolio value in SOL.
   *
   * @type {Signal<number>}
   * @readonly
   * @description
   * This computed property returns a Signal that represents the total portfolio value
   * converted to SOL. It calculates this by dividing the portfolio total USD value
   * by the current SOL price.
   *
   * @returns {Signal<number>} A Signal representing the total portfolio value in SOL.
   */
  public portfolioValueInSOL: Signal<number> = computed(() =>
    this.portfolioTotalUsdValue() / this._jupStore.solPrice())

  /**
   * Toggles the exclusion status of an asset group.
   *
   * @param {string} group - The name of the asset group to toggle.
   * @returns {void}
   *
   * @remarks
   * This method normalizes the input group name, then updates the excludedAssets
   * Set accordingly. If the group is already excluded, it will be added back;
   * otherwise, it will be excluded.
   */
    toggleAssetExclusion(group: string): void {
      const normalizedGroup = group.replace(/\s+/g, '');
      this.excludedAssets.update(set => {
        const newSet = new Set(set);
        if (newSet.has(normalizedGroup)) {
          newSet.delete(normalizedGroup);
        } else {
          newSet.add(normalizedGroup);
        }
        return newSet;
      });
    }

  public assetClassValue = computed(() => {
    const assets = this.getEnabledWalletsAssets();

    if (!assets) return [];
    return assets
      .map(assetClass => ({
        group: assetClass?.label ? (assetClass?.label === 'NFTs' ? 'NFTs' : assetClass?.label.replace(/([A-Z])/g, ' $1').trim()) : assetClass?.label,
        value: assetClass?.value,
        color: this.colorPicker(assetClass?.label),
        excluded: this.excludedAssets().has(assetClass?.label)
      }))
      .reduce((a, c) => {
        const obj = a.find((obj) => obj.group === c.group);
        if (!obj) {
          a.push(c);
        } else {
          obj.value += c.value;
          obj.excluded = obj.excluded && c.excluded;
        }
        return a;
      }, [])
      .filter(asset => asset.value > 0)
      .sort((a, b) => b.value - a.value);
  });

  /**
   * Gets an array of enabled portfolios.
   *
   * @type {Signal<WalletEntry[]>}
   * @readonly
   * @description
   * This computed property returns a Signal that contains an array of portfolios
   * where each portfolio has an enabled status set to true.
   *
   * @returns {Signal<WalletEntry[]>} A Signal representing an array of enabled portfolios.
   */
  private getEnabledPortfolio: Signal<WalletEntry[]> = computed(() => {
    return this._portfolioService.portfolio()
      .filter(({ portfolio }) => portfolio.enabled)
  });

  private getRandomColor(): string {
    let letters = '0123456789ABCDEF';
    let color = '#';
    for (let i = 0; i < 6; i++) {
      color += letters[Math.floor(Math.random() * 16)];
    }
    return color;
  }

  private colorPicker(assetClass: string): string {
    let color = ''

    switch (assetClass) {
      case 'Wallet':
        color = '#341663'
        break;
      case 'Staked':
        color = '#7209B7'
        break;
      case 'NFTs':
        color = '#F7E8FF'
        break;

      case 'LiquidityPool':
        color = '#560BAD'
        break;
      case 'Lending':
        color = '#B5179E'
        break;
      case 'Rewards':
        color = '#F72585'
        break;
      case 'Airdrop':
        color = '#b82568'
        break;
      case 'Deposit':
        color = '#E9CDC2'
        break;
      case 'Farming':
        color = '#341663'
        break;
      case 'Vesting':
        color = '#b58ef2'
        break;
      case 'Leverage':
        color = '#8ea3f2'
        break;
      default:
        color = this.getRandomColor()
        break;
    }

    return color
  }
}
