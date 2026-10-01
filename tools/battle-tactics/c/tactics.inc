/* Script command order only; source C owns accuracy, damage and field math. */
static void TacticsReset(void){gWishFutureKnock.weatherDuration=0;}
static bool8 TacticsWeatherValid(void){return gBattleWeather==0?gWishFutureKnock.weatherDuration==0:
 gBattleWeather==B_WEATHER_RAIN_TEMPORARY&&gWishFutureKnock.weatherDuration>=1&&gWishFutureKnock.weatherDuration<=5;}
s32 tactics_get(u32 field){if(field==0)return gBattleWeather;if(field==1)return gWishFutureKnock.weatherDuration;
 if(field==2)return gBattleCommunication[MULTISTRING_CHOOSER];return -1;}
s32 tactics_field_end_turn(void){if(!sRoute1Started||gBattleOutcome||sPartyPhase||!sFamilyOrderReady)return Fail(SPIKE_NOT_READY);
 if(!TacticsWeatherValid())return Fail(SPIKE_UNSUPPORTED);sStatus=SPIKE_OK;SourceTacticsRainEnd();return sStatus;}
static void TacticsFailed(void){gMoveResultFlags|=MOVE_RESULT_FAILED;}
static s32 FamilyAttack(u32 actor,u32 slot){
 if(actor>=2||slot>4)return Fail(SPIKE_INVALID_ARGUMENT);
 u32 move=slot==4?MOVE_STRUGGLE:gBattleMons[actor].moves[slot];
 if(move!=MOVE_SUPER_FANG&&move!=MOVE_ENDEAVOR&&move!=MOVE_RAIN_DANCE&&move!=MOVE_WHIRLWIND)return BaseFamilyAttack(actor,slot);
 s32 ready=ActorReady(actor);if(ready)return ready;
 if(!sRoute1Started||!sFamilyOrderReady||!TacticsWeatherValid())return Fail(SPIKE_NOT_READY);
 u32 target=actor^1;if(!sConfigured[target]||!gBattleMons[actor].hp||!gBattleMons[target].hp||!gBattleMons[actor].pp[slot])return Fail(SPIKE_NOT_READY);
 sStatus=SPIKE_OK;sEventCount=0;Zero(sEvents,sizeof(sEvents));gBattlerAttacker=actor;gBattlerTarget=move==MOVE_RAIN_DANCE?actor:target;
 gCurrMovePos=slot;gCurrentMove=move;gCurrentTurnActionNumber=GetBattlerTurnOrderNum(actor);
 gCritMultiplier=gBattleScripting.dmgMultiplier=1;gBattleMoveDamage=gHpDealt=sBaseDamage=sAfterCritical=sAfterType=0;
 gHitMarker=0;gMoveResultFlags=0;gProtectStructs[actor].noValidMoves=0;
 Zero(gBattleCommunication,sizeof(gBattleCommunication));Zero(gSpecialStatuses,sizeof(gSpecialStatuses));
 gProtectStructs[actor].targetNotAffected=0;gProtectStructs[target].physicalDmg=gProtectStructs[target].specialDmg=0;
 if(SourceFamilyTryFlinch()){Emit(8,actor,gBattleMons[actor].status2);Emit(9,actor,1);return sStatus;}
 if(move==MOVE_SUPER_FANG)Accuracy();Command();Cmd_ppreduce();if(sStatus)return sStatus;
 if(move==MOVE_RAIN_DANCE){Command();Cmd_setrain();return sStatus;}
 if(move==MOVE_WHIRLWIND){
  /* Suction Cups/rooting/Protect/airborne states cannot enter this profile.
   * Keep both source accuracy commands, including its no-roll preflight. */
  Command();Write32(sCommandScript+1,(u32)sFailedScript);sCommandScript[5]=(u8)NO_ACC_CALC_CHECK_LOCK_ON;sCommandScript[6]=NO_ACC_CALC_CHECK_LOCK_ON>>8;Cmd_accuracycheck();
  if(sStatus||gBattlescriptCurrInstr==sFailedScript){if(!sStatus)TacticsFailed();return sStatus;}
  Accuracy();if(sStatus||(gMoveResultFlags&MOVE_RESULT_NO_EFFECT))return sStatus;
  Command();Write32(sCommandScript+1,(u32)sFailedScript);
  if(TryDoForceSwitchOut()){
   /* Exact ordinary-wild SuccessForceOut terminal operation; no reserve
    * shuffle, no runTries mutation, no residuals or subsequent action. */
   gBattleOutcome=B_OUTCOME_PLAYER_TELEPORTED;gCurrentTurnActionNumber=gBattlersCount;
  }else TacticsFailed();return sStatus;
 }
 if(move==MOVE_ENDEAVOR){Command();Write32(sCommandScript+1,(u32)sFailedScript);Cmd_setdamagetohealthdifference();
  if(gBattlescriptCurrInstr==sFailedScript){TacticsFailed();return sStatus;}
  gHpDealt=gBattleMoveDamage;Accuracy();
 }
 if(sStatus||(gMoveResultFlags&MOVE_RESULT_NO_EFFECT))return sStatus;
 Command();Cmd_typecalc();gMoveResultFlags&=~(MOVE_RESULT_SUPER_EFFECTIVE|MOVE_RESULT_NOT_VERY_EFFECTIVE);
 if(move==MOVE_SUPER_FANG){Command();Cmd_damagetohalftargethp();}
 else if(!(gMoveResultFlags&MOVE_RESULT_NO_EFFECT)){gBattleMoveDamage=gHpDealt;Command();Cmd_adjustsetdamage();}
 gBattlescriptCurrInstr=sTargetScript;Cmd_healthbarupdate();gBattlescriptCurrInstr=sTargetScript;Cmd_datahpupdate();
 Command();Cmd_seteffectwithchance();return sStatus;
}
