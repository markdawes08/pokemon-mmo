/* Headless transport for BattleScript_EffectMirrorMove. The source command
 * chooses the move and target; the retained source effect schedules execute
 * that move without rewriting any creature's owned moves or PP slot. */
static void MirrorReset(void){
 gChosenMove=sMirrorDispatchMove=sMirrorActualMove=sMirrorChosenMove=0;
 sMirrorCopied=sMirrorTarget=sMirrorResultFlags=0;
}
static u32 MirrorActionMove(u32 actor,u32 slot){
 if(sMirrorDispatchMove)return sMirrorDispatchMove;
 if(ChargeActive(actor))return gLockedMoves[actor];
 return slot==4?MOVE_STRUGGLE:gBattleMons[actor].moves[slot];
}
static bool8 MirrorCopyable(u32 move){
 return move<MOVES_COUNT&&FamilyMoveAllowed(move)&&(gBattleMoves[move].flags&FLAG_MIRROR_MOVE_AFFECTED);
}
s32 mirror_get(u32 actor,u32 field){
 if(actor>=2)return -1;
 switch(field){case 0:return T1_READ_16(gBattleStruct->lastTakenMove+actor*2);
 case 1:return T1_READ_16(gBattleStruct->lastTakenMoveFrom+actor*8+(actor^1)*2);
 case 2:return sMirrorActualMove;case 3:return sMirrorCopied;default:return -1;}
}
static void MirrorRememberAction(u32 actor){
 sProtectPending=1;sProtectActor=actor;sProtectMove=gCurrentMove;
 sProtectObeys=(gHitMarker&HITMARKER_OBEYS)!=0;
 sMirrorActualMove=gCurrentMove;sMirrorChosenMove=gChosenMove;
 sMirrorTarget=gBattlerTarget;sMirrorResultFlags=gMoveResultFlags;
}
static s32 FamilyAttack(u32 actor,u32 slot){
 if(sProtectPending||sPursuitPending||sPursuitConsumed)return Fail(SPIKE_NOT_READY);
 s32 ready=ActorReady(actor);if(ready)return ready;
 if(!sRoute1Started||!sFamilyOrderReady||slot>4)return Fail(SPIKE_NOT_READY);
 u32 target=actor^1;
 if(!sConfigured[target]||!gBattleMons[actor].hp||!gBattleMons[target].hp)return Fail(SPIKE_NOT_READY);
 sMirrorDispatchMove=0;sMirrorCopied=0;
 gChosenMove=MirrorActionMove(actor,slot);sMirrorActualMove=gChosenMove;
 if(gChosenMove==MOVE_MIRROR_MOVE){
  if(slot>=4||!gBattleMons[actor].pp[slot])return Fail(SPIKE_INVALID_ARGUMENT);
  /* This initial attackcanceler can flinch before trymirrormove. Protect has
   * no effect on Mirror Move itself (source flags=0); it can block the called
   * effect's second attackcanceler. Healthy/poison/burn obedience is admitted. */
  sStatus=SPIKE_OK;sEventCount=0;Zero(sEvents,sizeof(sEvents));
  gBattlerAttacker=actor;gBattlerTarget=target;gCurrMovePos=slot;gCurrentMove=gChosenMove;
  gCurrentTurnActionNumber=GetBattlerTurnOrderNum(actor);
  gCritMultiplier=gBattleScripting.dmgMultiplier=1;gBattleMoveDamage=gHpDealt=sBaseDamage=sAfterCritical=sAfterType=0;
  gHitMarker=0;gMoveResultFlags=0;gProtectStructs[actor].noValidMoves=0;
  Zero(gBattleCommunication,sizeof(gBattleCommunication));Zero(gSpecialStatuses,sizeof(gSpecialStatuses));
  gProtectStructs[actor].targetNotAffected=0;gProtectStructs[target].physicalDmg=gProtectStructs[target].specialDmg=0;
  if(SourceFamilyTryFlinch()){
   Emit(8,actor,gBattleMons[actor].status2);Emit(9,actor,1);MirrorRememberAction(actor);return sStatus;
  }
  Command();ProtectCanceller();
  u32 last=T1_READ_16(gBattleStruct->lastTakenMove+actor*2);
  u32 from=T1_READ_16(gBattleStruct->lastTakenMoveFrom+actor*8+target*2);
  if((last&&last!=MOVE_UNAVAILABLE&&!MirrorCopyable(last))
   ||(from&&from!=MOVE_UNAVAILABLE&&!MirrorCopyable(from)))return Fail(SPIKE_UNSUPPORTED);
  Command();Cmd_trymirrormove();
  if(gCurrentMove==MOVE_MIRROR_MOVE){
   /* Failed source continuation pays this occupied Mirror slot exactly once. */
   Command();Cmd_ppreduce();gMoveResultFlags|=MOVE_RESULT_FAILED;
   MirrorRememberAction(actor);return sStatus;
  }
  if(!MirrorCopyable(gCurrentMove)
   ||gBattlescriptCurrInstr!=gBattleScriptsForMoveEffects[gBattleMoves[gCurrentMove].effect])return Fail(SPIKE_UNSUPPORTED);
  sMirrorCopied=1;sMirrorDispatchMove=gCurrentMove;
 }
 s32 result=ProtectedFamilyAttack(actor,slot);
 if(!result)MirrorRememberAction(actor);
 sMirrorDispatchMove=0;return result;
}
static void MirrorMoveEnd(void){
 /* Host faint cleanup changes the working attacker. Resume the original
  * script's attacker/target/chosen move and result flags, then retain the
  * actual faint marker (source tryfaintmon) before the selected moveend case. */
 gBattlerAttacker=sProtectActor;gBattlerTarget=sMirrorTarget;
 gChosenMove=sMirrorChosenMove;gMoveResultFlags=sMirrorResultFlags;
 for(u32 actor=0;actor<2;actor++)if(!gBattleMons[actor].hp)gHitMarker|=HITMARKER_FAINTED(actor);
 SourceMirrorMoveEnd();
}
static s32 MirrorValidateCheckpoint(const u32 *w){
 for(u32 actor=0;actor<2;actor++){
  u32 last=w[495+actor],from=w[497+actor];
  /* In admitted singles these two source writes/clears always happen together.
   * NONE is the only reachable empty sentinel; fallback remains source code
   * but cannot be manufactured by a settled singles checkpoint. */
  if(last!=from||(last&&!MirrorCopyable(last)))return SPIKE_INVALID_ARGUMENT;
  if(last){
   const u32 *other=w+16+48*(actor^1);bool8 known=FALSE;
   if(!w[17+48*actor]||(!other[1]&&last!=MOVE_STRUGGLE))return SPIKE_INVALID_ARGUMENT;
   if(last==MOVE_STRUGGLE){known=TRUE;for(u32 slot=0;slot<4;slot++)if(other[26+slot])known=FALSE;}
   for(u32 slot=0;slot<4;slot++){
    u32 owned=other[22+slot];
    if((owned==last||(last==MOVE_SKULL_BASH&&owned==MOVE_MIRROR_MOVE))
     &&other[26+slot]<FamilyMaxPP(owned,w[152+(actor^1)],slot))known=TRUE;
   }
   if(!known)return SPIKE_INVALID_ARGUMENT;
  }
 }
 return SPIKE_OK;
}
