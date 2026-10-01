/* Source Skull Bash script schedule; numerical/stat/effect commands are source C. */
static bool8 ChargeActive(u32 actor){return actor<2&&(gBattleMons[actor].status2&STATUS2_MULTIPLETURNS)!=0;}
static bool8 ChargeSlotValid(u32 actor,u32 slot){return actor<2&&slot<4&&slot==gBattleStruct->chosenMovePositions[actor]
 &&gLockedMoves[actor]==MOVE_SKULL_BASH&&gBattleMons[actor].moves[slot]==MOVE_SKULL_BASH
 &&gBattleStruct->moveTarget[actor]==(actor^1);}
static void ChargeReset(void){Zero(gLockedMoves,sizeof(gLockedMoves));}
s32 charge_get(u32 actor,u32 field){if(actor>=2)return -1;switch(field){case 0:return ChargeActive(actor);
 case 1:return gBattleStruct->chosenMovePositions[actor];case 2:return gLockedMoves[actor];
 case 3:return gProtectStructs[actor].chargingTurn;case 4:return gBattleStruct->moveTarget[actor];default:return -1;}}
static s32 ChargeFirstTurn(u32 actor,u32 target){
 Command();Cmd_ppreduce();if(sStatus)return sStatus;
 gHitMarker|=HITMARKER_CHARGING;gBattleStruct->moveTarget[actor]=target;
 gBattleCommunication[MOVE_EFFECT_BYTE]=MOVE_EFFECT_CHARGING|MOVE_EFFECT_AFFECTS_USER;
 Command();Cmd_seteffectprimary();if(sStatus)return sStatus;Emit(8,actor,gBattleMons[actor].status2);
 u32 before=gBattleMons[actor].statStages[STAT_DEF];
 gBattleScripting.statChanger=SET_STAT_BUFF_VALUE(1)|STAT_DEF;
 Command();sCommandScript[1]=MOVE_EFFECT_AFFECTS_USER|STAT_CHANGE_ALLOW_PTR;Write32(sCommandScript+2,(u32)sFailedScript);
 Cmd_statbuffchange();if(before!=gBattleMons[actor].statStages[STAT_DEF])Emit(6,actor,STAT_DEF*16+gBattleMons[actor].statStages[STAT_DEF]);
 /* Source action-finished clears per-action charging marker, not the lock. */
 gHitMarker&=~HITMARKER_CHARGING;return sStatus;
}
static void ChargeClearForRelease(u32 actor){
 gBattleCommunication[MOVE_EFFECT_BYTE]=MOVE_EFFECT_CHARGING;
 gBattlescriptCurrInstr=sLifecycleActorScript;Cmd_clearstatusfromeffect();
 Emit(8,actor,gBattleMons[actor].status2);gHitMarker|=HITMARKER_NO_PPDEDUCT;
}
static s32 ChargeValidateCheckpoint(const u32 *w){
 for(u32 actor=0;actor<2;actor++){
  const u32 *m=w+16+48*actor;u32 slot=w[11+actor],locked=w[485+actor],charging=w[487+actor],target=w[489+actor];
  if((locked!=0&&locked!=MOVE_SKULL_BASH)||charging>1||target!=(locked?(actor^1):0))return SPIKE_UNSUPPORTED;
  bool8 active=(m[11]&STATUS2_MULTIPLETURNS)!=0;
  if(active&&(!m[1]||locked!=MOVE_SKULL_BASH||m[22+slot]!=MOVE_SKULL_BASH||m[47]
    ||m[26+slot]>=FamilyMaxPP(MOVE_SKULL_BASH,w[152+actor],slot)))return SPIKE_INVALID_ARGUMENT;
  if(active&&w[3]!=0&&w[9+actor]!=B_ACTION_USE_MOVE)return SPIKE_INVALID_ARGUMENT;
  if(charging&&(!active||w[3]==0))return SPIKE_INVALID_ARGUMENT;
 }
 return SPIKE_OK;
}
