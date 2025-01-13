import { Injectable } from '@angular/core';
import { PublicKey } from '@solana/web3.js';
import { BehaviorSubject, map, switchMap } from 'rxjs';
import { Validator } from 'src/app/models/stakewiz.model';
import { NativeStakeService, PortfolioService, SolanaHelpersService, UtilService } from 'src/app/services';
import { HttpFetchService } from 'src/app/services/http-fetch.service';
import { LiquidStakeService } from 'src/app/services/liquid-stake.service';


export interface LiquidStakeToken {
  chainId: number
  address: string
  symbol: string
  mint: string
  name: string
  decimals: number
  logoURI: string
  balance: number
  price: number
  value: number
  frozen: boolean
  type: string
  apy: number
  exchangeRate: number
  poolPublicKey: string
  tokenMint: string
  state: string
}


export interface StakeAccount {
    amount: number
    role: Array<string>
    state: string
    type: string
    voter: string
    deactivationEpoch?: number
    active_stake_amount: number
    delegated_stake_amount: number
    rentExemptReserve: number
    balance: number
    address: string
    activation_epoch: number
    stake_type: number
    symbol: string
    validator?: Validator
    exchangeRate: number
}

export interface StakePositions {
  native: StakeAccount[];
  liquid: LiquidStakeToken[];
}

@Injectable({
  providedIn: 'root'
})
export class StakeService {
  private _nativePositions: StakeAccount[] = [];
  private _positions: StakePositions | null = null;

  
  constructor(
    private _lss: LiquidStakeService,
    private _nss: NativeStakeService,
    private _shs: SolanaHelpersService,
    private _portfolio: PortfolioService,
    private _httpFetchService: HttpFetchService,
    private _util: UtilService
  ) {
    
  }
  private _stakePositions$ = new BehaviorSubject<StakePositions | null>(null);
  public readonly stakePositions = this._stakePositions$.value;
  public readonly stakePositions$ = this._stakePositions$.asObservable().pipe(
    switchMap(async positions => {
      if (!positions) return null;
      const nativePositionExtended = await Promise.all(
        positions.native.map(async position => {
          const {addrShort} = this._util.addrUtil(position.address);
          const validator = (await this._shs.getValidatorsList()).find(v => v.vote_identity === position.voter);
          return { ...position, validator, shortAddress: addrShort };
        })
      );
      return {
        native: nativePositionExtended,
        liquid: positions.liquid
      };
    })
  );
  public readonly nativePositions$ = this. _stakePositions$.asObservable().pipe(map(positions => positions?.native));
  public readonly liquidPositions$ = this. _stakePositions$.asObservable().pipe(map(positions => positions?.liquid));
  
  public async updateStakePositions(walletAddress: string) {
    try {
      const response: StakePositions = await this._httpFetchService.get(`/api/portfolio/get-stake?address=${walletAddress}`) as StakePositions;
      this._stakePositions$.next(response);
    } catch (error) {
      console.error('Error updating stake positions', error);
    }
  }
}