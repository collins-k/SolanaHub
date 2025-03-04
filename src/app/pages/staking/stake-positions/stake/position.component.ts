import { AfterContentInit, Component, EventEmitter, Input, OnChanges, OnInit, Output, signal, SimpleChanges, TemplateRef, ViewChild } from '@angular/core';
import { addIcons } from 'ionicons';
import { copyOutline, ellipsisVertical, lockClosedOutline, sparklesOutline, waterOutline } from 'ionicons/icons';
import {
  IonSkeletonText,
  IonPopover,
  IonContent,
  IonImg,
  IonChip,
  IonAccordion,
  IonAccordionGroup,
  IonIcon, IonRow } from '@ionic/angular/standalone';

import { CurrencyPipe, DatePipe, DecimalPipe } from '@angular/common';
import { JupStoreService, UtilService } from 'src/app/services';
import { PopoverController } from '@ionic/angular';
import { OptionsPopoverComponent } from './options-popover/options-popover.component';
import { Stake } from 'src/app/models';
import { CopyTextDirective } from 'src/app/shared/directives/copy-text.directive';
import { TooltipModule } from 'src/app/shared/layouts/tooltip/tooltip.module';
import { TooltipPosition } from 'src/app/shared/layouts/tooltip/tooltip.enums';
import { LiquidStakeToken, StakeAccount } from '@app/models';
import { ChipComponent } from 'src/app/shared/components/chip/chip.component';
import { ProInsightsComponent } from '../pro-insights/pro-insights.component';
import { IsProDirective } from "@app/shared/directives/is-pro.directive";
@Component({
  selector: 'position',
  templateUrl: './position.component.html',
  styleUrls: ['./position.component.scss'],
  standalone: true,
  imports: [
    CurrencyPipe,
    IonSkeletonText,
    IonImg,
    IonIcon,
    CurrencyPipe,
    CopyTextDirective,
    TooltipModule,
    ChipComponent,
    IonAccordion,
    IonAccordionGroup,
    IonRow,
    ProInsightsComponent,
    IonIcon,
    IsProDirective
  ]
})
export class PositionComponent implements OnInit{
  @Output() openProInsight = new EventEmitter<boolean>();
  @Input() stake: LiquidStakeToken | StakeAccount = null
  @Input() stakeAccounts: StakeAccount[] | LiquidStakeToken[] = null
  @Input() isOpenProInsight = false
  public toolTipPos = TooltipPosition.LEFT
  public solPrice = this._jupStore.solPrice;

  constructor(
    private _jupStore: JupStoreService,
    private _popoverController: PopoverController,
    private _utilService: UtilService,
    ) {
    addIcons({lockClosedOutline,waterOutline,copyOutline,sparklesOutline,ellipsisVertical});
  }
ngOnInit(): void {


}
  async presentPopover(e: Event) {

    const popover = await this._popoverController.create({
      component: OptionsPopoverComponent,
      componentProps: {stake: this.stake,stakeAccounts: this.stakeAccounts },
      event: e,
      backdropDismiss: true,
      dismissOnSelect:true,
      showBackdrop: false,
      cssClass:'stake-positions-actions-popover'
    });

    await popover.present();

    const { role } = await popover.onDidDismiss();
  }

  getLogoURI(stake: any): string {

      return stake.validator?.image || stake.logoURI || 'assets/images/unknown.svg';
  }
getStakeName(stake: any): string {
  return stake.validator?.name || stake?.symbol;
}

getAccountShortAddress(stake: any): string {
  if(stake.source === 'liquid'){
    return this._utilService.addrUtil(stake.mint).addrShort;
  }
  return this._utilService.addrUtil(stake.address).addrShort;
}
getStakeApy(stake: any): number {
  return  (stake.validator?.total_apy || stake?.apy) ;
}
getStakeBalance(stake: any): string {
  return this._utilService.fixedNumber(stake?.balance);
}
emitOpenProInsight(){
  this.openProInsight.emit();

}
}
