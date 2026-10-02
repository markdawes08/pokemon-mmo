/* Transport for the selected source attack-canceller/move-end branches.
 * Cmd_setprotectlike and the rate policy live in generated source includes. */
static void ProtectReset(void){sProtectPending=sProtectActor=sProtectObeys=0;sProtectMove=0;}
s32 protect_get(u32 actor,u32 field){if(actor>=2)return -1;switch(field){
 case 0:return gProtectStructs[actor].protected;case 1:return gDisableStructs[actor].protectUses;
 case 2:return gLastResultingMoves[actor];default:return -1;}}
s32 protect_rate(u32 index){return index<256?sProtectSuccessRates[index]:-1;}
static s32 FamilyAttack(u32 actor,u32 slot){
 if(sProtectPending)return Fail(SPIKE_NOT_READY);
 s32 result=UnprotectedFamilyAttack(actor,slot);
 if(!result){sProtectPending=1;sProtectActor=actor;sProtectMove=gCurrentMove;sProtectObeys=(gHitMarker&HITMARKER_OBEYS)!=0;}
 return result;
}
s32 protect_move_end(u32 actor){
 if(!sProtectPending||actor>=2||actor!=sProtectActor)return Fail(SPIKE_NOT_READY);
 /* Ordinary-wild Whirlwind finishaction bypasses MOVEEND entirely. */
 if(gBattleOutcome!=B_OUTCOME_PLAYER_TELEPORTED){
  gBattlerAttacker=sProtectActor;gCurrentMove=sProtectMove;
  if(sProtectObeys)gHitMarker|=HITMARKER_OBEYS;else gHitMarker&=~HITMARKER_OBEYS;
  SourceProtectMoveEnd();
 }
 sProtectPending=0;return Fail(SPIKE_OK);
}
static s32 ProtectValidateCheckpoint(const u32 *w){
 for(u32 actor=0;actor<2;actor++){
  const u32 *m=w+16+48*actor;u32 count=w[491+actor],protected=w[493+actor],slot=w[11+actor];
  if(count>255||protected>1)return SPIKE_INVALID_ARGUMENT;
  if(m[43]!=MOVE_NONE&&m[43]!=MOVE_UNAVAILABLE&&m[43]!=MOVE_STRUGGLE){
   bool8 known=FALSE;for(u32 i=0;i<4;i++)if(m[22+i]==m[43])known=TRUE;
   if(!known)return SPIKE_INVALID_ARGUMENT;
  }
  if(!m[1]&&(count||protected))return SPIKE_INVALID_ARGUMENT;
  if(protected){
   if(w[3]==0||w[3]==2||w[9+actor]!=B_ACTION_USE_MOVE||m[22+slot]!=MOVE_PROTECT||m[43]!=MOVE_PROTECT
    ||m[26+slot]>=FamilyMaxPP(MOVE_PROTECT,w[152+actor],slot)||(m[11]&STATUS2_MULTIPLETURNS))return SPIKE_INVALID_ARGUMENT;
  }
 }
 return SPIKE_OK;
}
