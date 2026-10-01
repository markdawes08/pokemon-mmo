/* Source numerical commands remain in the shared extraction. This is the
 * bounded headless source-script scheduler and validated admission transport. */
static bool8 FamilyIdentity(u32 species,u32 ability)
{
    if(species>=SPECIES_SQUIRTLE&&species<=SPECIES_BLASTOISE)return ability==ABILITY_TORRENT;
    if(species>=SPECIES_PIDGEY&&species<=SPECIES_PIDGEOT)return ability==ABILITY_KEEN_EYE;
    if(species==SPECIES_RATTATA||species==SPECIES_RATICATE)return ability==ABILITY_RUN_AWAY||ability==ABILITY_GUTS;
    return FALSE;
}
bool8 FamilyMoveAllowed(u32 move)
{
    switch(move){
    case MOVE_TACKLE:case MOVE_TAIL_WHIP:case MOVE_SAND_ATTACK:case MOVE_WATER_GUN:
    case MOVE_BUBBLE:case MOVE_WITHDRAW:case MOVE_QUICK_ATTACK:case MOVE_GUST:
    case MOVE_WING_ATTACK:case MOVE_HYDRO_PUMP:case MOVE_BITE:case MOVE_HYPER_FANG:
    case MOVE_AGILITY:case MOVE_FEATHER_DANCE:case MOVE_SCARY_FACE:case MOVE_FOCUS_ENERGY:case MOVE_STRUGGLE:return TRUE;
    default:return FALSE;
    }
}
static bool8 FamilyWildTransport(u8 buffer,u8 action,u16 value)
{
    u32 slot=value&255;if(buffer!=1||action!=10||gActiveBattler!=1||slot>=4)return FALSE;
    u32 move=gBattleMons[1].moves[slot];if(!FamilyMoveAllowed(move))return FALSE;
    u32 target=(gBattleMoves[move].target&(MOVE_TARGET_USER_OR_SELECTED|MOVE_TARGET_USER))?1:0;
    return (value>>8)==target;
}
static void FamilyReset(void)
{Zero(gBattlerByTurnOrder,sizeof(gBattlerByTurnOrder));sFamilyOrderReady=0;FamilyResetInputs();}
static void FamilyBeginTurn(void)
{SourceFamilyClearFlinch();sFamilyOrderReady=0;}
s32 FamilyApplyMon(u32 actor,const u32 *w,u32 ability,u32 type1,u32 type2)
{
    if(!sInitialized||actor>=2||sRoute1Started||gBattleOutcome)return SPIKE_NOT_READY;
    /* The separate source validator has completed all fallible validation.
     * Install a complete supported battler; no arithmetic or RNG follows. */
    struct BattlePokemon *m=&gBattleMons[actor];Zero(m,sizeof(*m));
    m->species=w[0];m->personality=w[1];m->otId=w[2];m->level=w[4];m->friendship=w[5];
    m->hp=w[6];m->maxHP=w[7];m->attack=w[8];m->defense=w[9];m->speed=w[10];m->spAttack=w[11];m->spDefense=w[12];
    m->hpIV=w[13];m->attackIV=w[14];m->defenseIV=w[15];m->speedIV=w[16];m->spAttackIV=w[17];m->spDefenseIV=w[18];
    for(u32 i=0;i<4;i++){m->moves[i]=w[25+i];m->pp[i]=w[29+i];}m->ppBonuses=w[33];
    m->status1=w[36];m->ability=ability;m->type1=type1;m->type2=type2;
    for(u32 i=0;i<NUM_BATTLE_STATS;i++)m->statStages[i]=DEFAULT_STAT_STAGE;
    gSpeciesInfo[m->species].types[0]=type1;gSpeciesInfo[m->species].types[1]=type2;sConfigured[actor]=1;
    return SPIKE_OK;
}
s32 family_start(void){return route1_start();}
s32 family_choose_wild(void){return route1_choose_wild();}
s32 family_order(u32 slot0,u32 slot1,u32 action)
{
    if(action>1)return -SPIKE_UNSUPPORTED;s32 first=route1_order(slot0,slot1,action);if(first<0)return first;
    gBattlerByTurnOrder[0]=first?1:0;gBattlerByTurnOrder[1]=gBattlerByTurnOrder[0]^1;sFamilyOrderReady=1;return first;
}
s32 family_run(u32 actor){if(!sFamilyOrderReady)return -SPIKE_NOT_READY;return route1_run(actor);}
s32 family_get(u32 field)
{
    if(field<4)return route1_get(field);
    if(field<6)return (gBattleMons[field-4].status2&STATUS2_FOCUS_ENERGY)!=0;
    if(field<8)return (gBattleMons[field-6].status2&STATUS2_FLINCHED)!=0;
    if(field<10)return gBattleMons[field-8].ppBonuses;return -1;
}
static s32 FamilyAttack(u32 actor,u32 slot)
{
    s32 ready=ActorReady(actor);if(ready)return ready;
    if(!sRoute1Started||!sFamilyOrderReady||slot>4)return Fail(SPIKE_NOT_READY);
    u32 target=actor^1;if(!sConfigured[target]||!gBattleMons[actor].hp||!gBattleMons[target].hp)return Fail(SPIKE_NOT_READY);
    bool8 struggle=slot==4;
    if(struggle&&CheckMoveLimitations(actor,0,MOVE_LIMITATIONS_ALL)!=ALL_MOVES_MASK)return Fail(SPIKE_INVALID_ARGUMENT);
    u32 move=struggle?MOVE_STRUGGLE:gBattleMons[actor].moves[slot];
    if(!FamilyMoveAllowed(move)||(!struggle&&!gBattleMons[actor].pp[slot]))return Fail(SPIKE_UNSUPPORTED);
    u32 effect=gBattleMoves[move].effect;
    bool8 selfStat=effect==EFFECT_DEFENSE_UP||effect==EFFECT_SPEED_UP_2;
    bool8 targetStat=effect==EFFECT_DEFENSE_DOWN||effect==EFFECT_ACCURACY_DOWN||effect==EFFECT_ATTACK_DOWN_2||effect==EFFECT_SPEED_DOWN_2;
    bool8 focus=move==MOVE_FOCUS_ENERGY;
    if(!selfStat&&!targetStat&&!focus){
        bool8 physical=IS_TYPE_PHYSICAL(gBattleMoves[move].type);
        u32 defense=physical?gBattleMons[target].defense:gBattleMons[target].spDefense;
        u32 stage=gBattleMons[target].statStages[physical?STAT_DEF:STAT_SPDEF];
        if(defense*gStatStageRatios[stage][0]/gStatStageRatios[stage][1]==0)return Fail(SPIKE_UNSAFE_DEFENSE);
    }
    sStatus=SPIKE_OK;sEventCount=0;Zero(sEvents,sizeof(sEvents));
    gBattlerAttacker=actor;gBattlerTarget=(selfStat||focus)?actor:target;gCurrMovePos=struggle?0:slot;gCurrentMove=move;
    gCurrentTurnActionNumber=GetBattlerTurnOrderNum(actor);
    gCritMultiplier=gBattleScripting.dmgMultiplier=1;gBattleMoveDamage=gHpDealt=sBaseDamage=sAfterCritical=sAfterType=0;
    gHitMarker=struggle?HITMARKER_NO_PPDEDUCT:0;gMoveResultFlags=0;gProtectStructs[actor].noValidMoves=0;
    Zero(gBattleCommunication,sizeof(gBattleCommunication));Zero(gSpecialStatuses,sizeof(gSpecialStatuses));
    gProtectStructs[actor].targetNotAffected=0;gProtectStructs[target].physicalDmg=gProtectStructs[target].specialDmg=0;
    /* Only the admitted source flinch branch can prevent these healthy or
     * poison/burn actions; status does not spend PP or accuracy RNG on flinch. */
    if(SourceFamilyTryFlinch()){Emit(8,actor,gBattleMons[actor].status2);Emit(9,actor,1);return sStatus;}
    if(!selfStat&&!focus)Accuracy();Command();Cmd_ppreduce();
    if(sStatus||(gMoveResultFlags&MOVE_RESULT_NO_EFFECT))return sStatus;
    if(focus){u32 before=gBattleMons[actor].status2;Command();Cmd_setfocusenergy();
        if(before!=gBattleMons[actor].status2)Emit(8,actor,gBattleMons[actor].status2);return sStatus;}
    if(selfStat||targetStat){
        u32 stat=STAT_DEF,amount=1;
        if(effect==EFFECT_SPEED_UP_2||effect==EFFECT_SPEED_DOWN_2){stat=STAT_SPEED;amount=2;}
        if(effect==EFFECT_ATTACK_DOWN_2){stat=STAT_ATK;amount=2;}if(effect==EFFECT_ACCURACY_DOWN)stat=STAT_ACC;
        u32 changed=selfStat?actor:target,before=gBattleMons[changed].statStages[stat];
        gBattleScripting.statChanger=SET_STAT_BUFF_VALUE(amount)|(targetStat?STAT_BUFF_NEGATIVE:0)|stat;
        Command();sCommandScript[1]=STAT_CHANGE_ALLOW_PTR|(selfStat?MOVE_EFFECT_AFFECTS_USER:0);Write32(sCommandScript+2,(u32)sFailedScript);
        Cmd_statbuffchange();if(before!=gBattleMons[changed].statStages[stat])Emit(6,changed,stat*16+gBattleMons[changed].statStages[stat]);return sStatus;
    }
    if(struggle)gBattleCommunication[MOVE_EFFECT_BYTE]=MOVE_EFFECT_RECOIL_25|MOVE_EFFECT_AFFECTS_USER|MOVE_EFFECT_CERTAIN;
    else if(effect==EFFECT_SPEED_DOWN_HIT)gBattleCommunication[MOVE_EFFECT_BYTE]=MOVE_EFFECT_SPD_MINUS_1;
    else if(effect==EFFECT_FLINCH_HIT)gBattleCommunication[MOVE_EFFECT_BYTE]=MOVE_EFFECT_FLINCH;
    /* Gust's source airborne doubling branch is unreachable: no admitted
     * move or checkpoint can create STATUS3_ON_AIR or another semi-invulnerable state. */
    Command();Cmd_critcalc();Command();Cmd_damagecalc();sAfterCritical=gBattleMoveDamage;sBaseDamage=sAfterCritical/gCritMultiplier;
    Command();Cmd_typecalc();sAfterType=gBattleMoveDamage;Command();Cmd_adjustnormaldamage();
    gBattlescriptCurrInstr=sTargetScript;Cmd_healthbarupdate();gBattlescriptCurrInstr=sTargetScript;Cmd_datahpupdate();
    s32 hitDamage=gBattleMoveDamage,hitDealt=gHpDealt;
    u32 beforeSpeed=gBattleMons[target].statStages[STAT_SPEED],beforeStatus=gBattleMons[target].status2;
    Command();Cmd_seteffectwithchance();
    if(beforeSpeed!=gBattleMons[target].statStages[STAT_SPEED])Emit(6,target,STAT_SPEED*16+gBattleMons[target].statStages[STAT_SPEED]);
    if(beforeStatus!=gBattleMons[target].status2)Emit(8,target,gBattleMons[target].status2);
    if(struggle&&gBattlescriptCurrInstr==sRecoilScript){
        gHitMarker|=HITMARKER_IGNORE_SUBSTITUTE|HITMARKER_PASSIVE_DAMAGE;gBattlescriptCurrInstr=sLifecycleActorScript;Cmd_healthbarupdate();
        gBattlescriptCurrInstr=sLifecycleActorScript;Cmd_datahpupdate();gHitMarker&=~(HITMARKER_IGNORE_SUBSTITUTE|HITMARKER_PASSIVE_DAMAGE);
    }
    gBattleMoveDamage=hitDamage;gHpDealt=hitDealt;gHitMarker&=~HITMARKER_NO_PPDEDUCT;return sStatus;
}
