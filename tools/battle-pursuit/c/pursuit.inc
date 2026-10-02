/* Source BattleScript_ActionSwitch / PursuitDmgOnSwitchOut transport.
 * The source command decides interception; source commands own damage/RNG. */
static void PursuitReset(void){
 gMultiHitCounter=gChosenMovePos=0;Zero(gActionsByTurnOrder,sizeof(gActionsByTurnOrder));Zero(gChosenMoveByBattler,sizeof(gChosenMoveByBattler));
 sPursuitPending=sPursuitIndex=sPursuitIntercepted=sPursuitCompleting=sPursuitConsumed=0;
}
static void PursuitFieldBegin(void){sPursuitConsumed=0;}
s32 pursuit_switch_prepare(u32 index){
 if(!sRoute1Started||gBattleOutcome||sPartyPhase||sProtectPending||sPursuitPending||sPursuitConsumed||!sFamilyOrderReady)return -SPIKE_NOT_READY;
 if(index>=sPartyCount||index==sPartyActive||!sParty[index][6]||!gBattleMons[0].hp||!gBattleMons[1].hp
  ||gChosenActionByBattler[0]!=B_ACTION_SWITCH||ChargeActive(0))return -SPIKE_INVALID_ARGUMENT;
 s32 ready=LifecycleReady(0);if(ready)return -ready;ready=LifecycleReady(1);if(ready)return -ready;
 u32 wildSlot=gBattleStruct->chosenMovePositions[1];if(wildSlot>=4)return -SPIKE_INVALID_ARGUMENT;
 if(gCurrentMove>=MOVES_COUNT||gBattleMoves[gCurrentMove].effect==EFFECT_BATON_PASS)return -SPIKE_UNSUPPORTED;
 if(!gProtectStructs[1].noValidMoves&&!ChargeActive(1)&&!gBattleMons[1].pp[wildSlot])return -SPIKE_INVALID_ARGUMENT;
 sStatus=SPIKE_OK;sEventCount=0;Zero(sEvents,sizeof(sEvents));
 sPursuitPending=1;sPursuitIndex=index;sPursuitIntercepted=0;
 /* Source increments this counter in HandleAction_Switch before its script. */
 SourcePartyCountSwitch();
 for(u32 actor=0;actor<2;actor++){
  u32 slot=gBattleStruct->chosenMovePositions[actor];
  gChosenMoveByBattler[actor]=gChosenActionByBattler[actor]==B_ACTION_USE_MOVE&&!gProtectStructs[actor].noValidMoves&&!ChargeActive(actor)
   ?gBattleMons[actor].moves[slot]:MOVE_NONE;
  gActionsByTurnOrder[GetBattlerTurnOrderNum(actor)]=gChosenActionByBattler[actor];
 }
 /* This ordinary-wild selected move's target is player-left. The retained
  * charge target is also player-left, so its inert/active storage is unchanged. */
 gBattleStruct->moveTarget[1]=0;gBattlerAttacker=0;gMultiHitCounter=1;
 gCurrentTurnActionNumber=GetBattlerTurnOrderNum(0);gBattleScripting.dmgMultiplier=2;
 Command();Write32(sCommandScript+1,(u32)sFailedScript);Cmd_jumpifnopursuitswitchdmg();
 if(gBattlescriptCurrInstr==sFailedScript)return 0;
 if(gBattlerTarget!=1||gCurrentMove!=MOVE_PURSUIT||gCurrMovePos!=wildSlot
  ||gActionsByTurnOrder[GetBattlerTurnOrderNum(1)]!=B_ACTION_TRY_FINISH)return -SPIKE_UNSUPPORTED;
 sPursuitIntercepted=sPursuitConsumed=1;
 /* Script swaps attacker/target and deliberately has no attackcanceler,
  * accuracy check, effect-with-chance or UPDATE_LAST_MOVES command. */
 gBattlerAttacker=1;gBattlerTarget=0;gCritMultiplier=1;
 gBattleMoveDamage=gHpDealt=sBaseDamage=sAfterCritical=sAfterType=0;gHitMarker=0;gMoveResultFlags=0;
 Zero(gBattleCommunication,sizeof(gBattleCommunication));Zero(gSpecialStatuses,sizeof(gSpecialStatuses));
 gProtectStructs[1].targetNotAffected=0;gProtectStructs[0].physicalDmg=gProtectStructs[0].specialDmg=0;
 Command();Cmd_ppreduce();Command();Cmd_critcalc();Command();Cmd_damagecalc();
 sAfterCritical=gBattleMoveDamage;sBaseDamage=sAfterCritical/gCritMultiplier/2;
 Command();Cmd_typecalc();sAfterType=gBattleMoveDamage;Command();Cmd_adjustnormaldamage();
 gBattlescriptCurrInstr=sTargetScript;Cmd_healthbarupdate();gBattlescriptCurrInstr=sTargetScript;Cmd_datahpupdate();
 return sStatus?-sStatus:1;
}
s32 pursuit_switch_complete(u32 index){
 if(!sPursuitPending||index!=sPursuitIndex||sPursuitCompleting||sProtectPending)return Fail(SPIKE_NOT_READY);
 if(!gBattleMons[0].hp&&(!sPursuitIntercepted||!(sPartyFaintMask&(1u<<sPartyActive))))return Fail(SPIKE_NOT_READY);
 /* Admitted on-damage/immunity/synchronize/choice-item effects are inert.
  * Source getexp on a player faint skips reward; selected replacement resumes. */
 sPursuitCompleting=1;s32 result=party_switch(index,0);sPursuitCompleting=0;
 if(result)return result;sPursuitPending=sPursuitIntercepted=sPursuitIndex=0;return Fail(SPIKE_OK);
}
