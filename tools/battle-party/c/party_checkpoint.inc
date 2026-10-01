static void PartyExport(u32 *w){w[154]=sPartyCount;w[155]=sPartyActive;w[156]=gSentPokesToOpponent[0];w[157]=sPartySwitches;
 w[158]=sPartyPhase;w[159]=sPartyDecision;for(u32 i=0;i<7;i++)for(u32 j=0;j<46;j++)w[160+i*46+j]=sParty[i][j];w[482]=sPartyFaintMask;}
static s32 PartyValidateCheckpoint(const u32 *w){
 u32 count=w[154],active=w[155],mask=w[156],phase=w[158],decision=w[159];
 if(count<1||count>6||active>=count||!mask||(mask&~((1u<<count)-1))||!(mask&(1u<<active))||w[157]>255||phase>2||decision>2)return SPIKE_INVALID_ARGUMENT;
 if(phase){if(w[3]!=phase||w[17]||!w[65]||w[8])return SPIKE_INVALID_ARGUMENT;}else if(decision||w[3]==1||w[3]==2)return SPIKE_INVALID_ARGUMENT;
 for(u32 j=483;j<512;j++)if(w[j])return SPIKE_INVALID_ARGUMENT;
 u32 faintMask=0,living=0;
 for(u32 i=0;i<7;i++){const u32 *m=w+160+i*46;
  if(i>=count&&i<6){for(u32 j=0;j<46;j++)if(m[j])return SPIKE_INVALID_ARGUMENT;continue;}
  if(PartyValidate(m))return SPIKE_INVALID_ARGUMENT;if(i<6){if(!m[6])faintMask|=1u<<i;else living++;}
 }
 if(w[482]!=faintMask||(phase&&!living))return SPIKE_INVALID_ARGUMENT;
 for(u32 actor=0;actor<2;actor++){
  const u32 *m=w+160+(actor?6:active)*46,*r=w+16+48*actor;
  if(r[0]!=m[4]||r[1]!=m[6]||r[2]!=m[7]||r[3]!=m[8]||r[4]!=m[9]||r[5]!=m[11]||r[6]!=m[12]||r[7]!=m[10]
   ||r[8]!=PartyMonField(m,3)||r[9]!=PartyMonField(m,4)||r[10]!=m[36]||r[30]!=m[0]||r[31]!=PartyMonField(m,0)||w[152+actor]!=m[33])return SPIKE_INVALID_ARGUMENT;
  for(u32 j=0;j<4;j++)if(r[22+j]!=m[25+j]||r[26+j]!=m[29+j])return SPIKE_INVALID_ARGUMENT;
 }
 for(u32 side=0;side<2;side++)for(u32 i=0;i<6;i++){const u32 *p=w+112+side*18+i*3,*m=w+160+(side?6:i)*46;
  bool8 occupied=side?i==0:i<count;if(p[0]!=(occupied?m[0]:0)||p[1]!=(occupied?m[6]:0)||p[2])return SPIKE_INVALID_ARGUMENT;}
 return SPIKE_OK;
}
static void PartyImport(const u32 *w){sPartyCount=w[154];sPartyActive=w[155];gSentPokesToOpponent[0]=w[156];sPartySwitches=w[157];
 sPartyPhase=w[158];sPartyDecision=w[159];sPartyFaintMask=w[482];for(u32 i=0;i<7;i++){sPartyValid[i]=i<sPartyCount||i==6;for(u32 j=0;j<46;j++)sParty[i][j]=w[160+i*46+j];}
 gBattlerPartyIndexes[0]=sPartyActive;gBattlerPartyIndexes[1]=0;
}
