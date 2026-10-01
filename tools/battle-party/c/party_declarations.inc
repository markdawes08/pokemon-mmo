/* Party-profile state is private, logical and separate from family v1. */
static u32 sParty[7][46],sPartyValid[7];
static u8 sPartyCount,sPartyActive,sPartySwitches,sPartyPhase,sPartyDecision,sPartyFaintMask;
static u8 gSentPokesToOpponent[2],gAbsentBattlerFlags;
static void PartyReset(void);
s32 PartyAdmit(u32,const u32 *,u32,u32,u32);
s32 PartyValidate(const u32 *);
u32 PartyMonField(const u32 *,u32);
void PartyFaintFriendship(u32 *,u32);
u8 GetAbilityBySpecies(u16,u8);
static void PartyExport(u32 *);
static s32 PartyValidateCheckpoint(const u32 *);
static void PartyImport(const u32 *);
static void PartyLoad(u32,const u32 *);
s32 party_sync(void);
#define PREPARE_MON_NICK_BUFFER(buffer,actor,index) ((void)0)
static const struct {u8 knockedOffMons[2];} gWishFutureKnock;
