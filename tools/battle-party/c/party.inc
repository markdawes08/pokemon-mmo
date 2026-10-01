/* Headless source-script/control transport. Numerical commands and cleanup
 * remain source bodies; all seven full party records survive raw recovery. */
static void PartyReset(void){Zero(sParty,sizeof(sParty));Zero(sPartyValid,sizeof(sPartyValid));Zero(gSentPokesToOpponent,sizeof(gSentPokesToOpponent));
 sPartyCount=sPartyActive=sPartySwitches=sPartyPhase=sPartyDecision=sPartyFaintMask=gAbsentBattlerFlags=0;}
s32 PartyAdmit(u32 index,const u32 *w,u32 ability,u32 type1,u32 type2){
 (void)ability;(void)type1;(void)type2;if(!sInitialized||index>=7||sRoute1Started)return SPIKE_NOT_READY;
 if(index==6&&!w[6])return SPIKE_INVALID_ARGUMENT;for(u32 i=0;i<46;i++)sParty[index][i]=w[i];sPartyValid[index]=1;return SPIKE_OK;}
static void PartyLoad(u32 actor,const u32 *w){
 struct BattlePokemon *m=&gBattleMons[actor];Zero(m,sizeof(*m));m->species=w[0];m->personality=w[1];m->otId=w[2];m->level=w[4];m->friendship=w[5];
 m->hp=w[6];m->maxHP=w[7];m->attack=w[8];m->defense=w[9];m->speed=w[10];m->spAttack=w[11];m->spDefense=w[12];
 m->hpIV=w[13];m->attackIV=w[14];m->defenseIV=w[15];m->speedIV=w[16];m->spAttackIV=w[17];m->spDefenseIV=w[18];
 m->abilityNum=w[39];m->ability=PartyMonField(w,0);m->type1=PartyMonField(w,3);m->type2=PartyMonField(w,4);
 for(u32 i=0;i<4;i++){m->moves[i]=w[25+i];m->pp[i]=w[29+i];}m->ppBonuses=w[33];m->status1=w[36];
 for(u32 i=0;i<NUM_BATTLE_STATS;i++)m->statStages[i]=DEFAULT_STAT_STAGE;
 gSpeciesInfo[m->species].types[0]=m->type1;gSpeciesInfo[m->species].types[1]=m->type2;sConfigured[actor]=1;
}
s32 party_sync(void){if(!sPartyCount||!sConfigured[0]||!sConfigured[1])return Fail(SPIKE_NOT_READY);
 for(u32 actor=0;actor<2;actor++){u32 *w=sParty[actor?6:sPartyActive];struct BattlePokemon *m=&gBattleMons[actor];
  w[6]=m->hp;w[36]=m->status1;for(u32 i=0;i<4;i++)w[29+i]=m->pp[i];}
 for(u32 i=0;i<6;i++){gPlayerParty[i].species=i<sPartyCount?sParty[i][0]:0;gPlayerParty[i].hp=i<sPartyCount?sParty[i][6]:0;gPlayerParty[i].isEgg=0;
  gEnemyParty[i].species=i==0?sParty[6][0]:0;gEnemyParty[i].hp=i==0?sParty[6][6]:0;gEnemyParty[i].isEgg=0;}
 return Fail(SPIKE_OK);}
s32 party_start(u32 count){if(!sInitialized||sRoute1Started||count<1||count>6||!sPartyValid[6])return Fail(SPIKE_NOT_READY);
 u32 first=6;for(u32 i=0;i<6;i++){if(sPartyValid[i]!=(i<count))return Fail(SPIKE_INVALID_ARGUMENT);if(i<count&&sParty[i][6]&&first==6)first=i;}
 if(first==6)return Fail(SPIKE_INVALID_ARGUMENT);sPartyCount=count;sPartyActive=first;
 for(u32 i=0;i<count;i++)if(!sParty[i][6])sPartyFaintMask|=1u<<i;
 PartyLoad(0,sParty[first]);PartyLoad(1,sParty[6]);gBattlerPartyIndexes[0]=first;gBattlerPartyIndexes[1]=0;party_sync();
 ResetSentPokesToOpponentValue();return route1_start();}
s32 party_order(u32 slot0,u32 slot1,u32 action){if(sPartyPhase||action>2)return -SPIKE_NOT_READY;
 u32 remembered=gBattleStruct->chosenMovePositions[0];s32 first=route1_order(slot0,slot1,action);if(first<0)return first;
 if(action)gBattleStruct->chosenMovePositions[0]=remembered;
 if(action==2)gChosenActionByBattler[0]=B_ACTION_SWITCH;
 gBattlerByTurnOrder[0]=first?1:0;gBattlerByTurnOrder[1]=gBattlerByTurnOrder[0]^1;sFamilyOrderReady=1;return first;}
s32 party_residual_order(void){if(!sRoute1Started||gBattleOutcome||sPartyPhase)return -SPIKE_NOT_READY;
 sStatus=SPIKE_OK;u32 first=GetWhoStrikesFirst(0,1,FALSE);gBattlerByTurnOrder[0]=first?1:0;gBattlerByTurnOrder[1]=gBattlerByTurnOrder[0]^1;sFamilyOrderReady=1;
 return sStatus?-sStatus:first;}
static bool8 PartyHasBench(void){for(u32 i=0;i<sPartyCount;i++)if(i!=sPartyActive&&sParty[i][6])return TRUE;return FALSE;}
s32 party_replacement_begin(u32 phase){if(!sRoute1Started||gBattleOutcome||sPartyPhase||phase<1||phase>2||gBattleMons[0].hp||!gBattleMons[1].hp||!PartyHasBench())return Fail(SPIKE_NOT_READY);
 if(!(sPartyFaintMask&(1u<<sPartyActive)))return Fail(SPIKE_NOT_READY);sPartyPhase=phase;sPartyDecision=0;return Fail(SPIKE_OK);}
s32 party_replacement_decide(u32 kind){if(!sPartyPhase||sPartyDecision||kind>1||gBattleOutcome)return -SPIKE_NOT_READY;
 if(!kind){sPartyDecision=1;gActiveBattler=0;SourcePartyCountForcedSwitch();return 0;}sStatus=SPIKE_OK;sEventCount=0;Zero(sEvents,sizeof(sEvents));
 bool8 escaped=TryRunFromBattle(0);if(sStatus)return -sStatus;
 if(escaped){if(gProtectStructs[0].fleeType==FLEE_ABILITY)Emit(7,0,ABILITY_RUN_AWAY);sPartyPhase=sPartyDecision=0;return 1;}
 sPartyDecision=2;gActiveBattler=0;SourcePartyCountForcedSwitch();return 0;}
s32 party_switch(u32 index,u32 forced){if(!sRoute1Started||gBattleOutcome||index>=sPartyCount||index==sPartyActive||!sParty[index][6]||forced>1)return Fail(SPIKE_INVALID_ARGUMENT);
 if(forced?(!sPartyPhase||!sPartyDecision||gBattleMons[0].hp):(sPartyPhase||!gBattleMons[0].hp||!sFamilyOrderReady||gChosenActionByBattler[0]!=B_ACTION_SWITCH))return Fail(SPIKE_NOT_READY);
 s32 ready=LifecycleReady(0);if(ready)return ready;
 if(gCurrentMove>=MOVES_COUNT||gBattleMoves[gCurrentMove].effect==EFFECT_BATON_PASS)return Fail(SPIKE_UNSUPPORTED);
 party_sync();struct BattlePokemon old=gBattleMons[0];PartyLoad(0,sParty[index]);
 for(u32 i=0;i<sizeof(struct BattlePokemon);i++)gBattleBufferB[0][4+i]=((u8 *)&gBattleMons[0])[i];gBattleMons[0]=old;
 sPartyActive=index;gBattlerPartyIndexes[0]=index;gBattlerAttacker=gActiveBattler=0;
 gBattlescriptCurrInstr=sLifecycleActorScript;Cmd_switchindataupdate();UpdateSentPokesToOpponentValue(0);
 /* Admitted four abilities and held-none have no source switch-in/out or
  * entry-hazard effect. Source data update executes the full cleanup body. */
 if(sStatus)return sStatus;if(!forced)SourcePartyCountSwitch();sPartyPhase=sPartyDecision=0;gProtectStructs[0].noValidMoves=0;return party_sync();}
s32 party_faint_cleanup(u32 actor){if(actor>=2||gBattleMons[actor].hp||gBattleOutcome)return Fail(SPIKE_NOT_READY);
 s32 ready=LifecycleReady(actor);if(ready)return ready;
 if(actor==0){if(sPartyFaintMask&(1u<<sPartyActive))return Fail(SPIKE_NOT_READY);
  PartyFaintFriendship(sParty[sPartyActive],gBattleMons[1].level);gBattleMons[0].friendship=sParty[sPartyActive][5];sPartyFaintMask|=1u<<sPartyActive;}
 s32 status=spike2_faint_cleanup(actor);if(status)return status;return party_sync();}
s32 party_get(u32 field){switch(field){case 0:return sPartyCount;case 1:return sPartyActive;case 2:return gSentPokesToOpponent[0];case 3:return sPartySwitches;
 case 4:return sPartyPhase;case 5:return sPartyDecision;case 6:return gBattleStruct->runTries;default:return -1;}}
u32 party_roster_get(u32 index,u32 word){return index<7&&word<46?sParty[index][word]:0;}
