# Ability triggers: every kind, listed (CN 1.8.1)

> Written by Claude (AI) in a Claude Code session. The codes and names are the client's own (read from the
> installed CN 1.8.1 client's table parser); the plain words are a reading of those names, and only the ones
> marked ✔ were seen working in game in this project. Counts are from CN's current ability and leader tables.

For the ability editor idea ([custom-unit-tooling.md](custom-unit-tooling.md#b-ability-editor-add-or-remove-what-an-ability-does-abilities-only)).

## What a "trigger" is

An ability is a list of lines; each line is one effect. Before its effect, a line has up to four "trigger" parts,
each a column holding a code:

| Part | Column (ability / leader) | Answers | Example from the unit page | Kinds in the client | Used by CN |
|---|---|---|---|---:|---:|
| **Line kind** | 5 / 3 | when, while or at battle start? | "→" (when) vs "while" | 3 | 3 |
| **Condition** ×3 | 6, 13, 20 / 4, 11, 18 | only if… (checked first; up to three, all must hold) | "the leader is ⟨wind⟩", "⟨wind⟩ resonates", "this unit is ⟨fire⟩" | 209 | 20 |
| **When** (event) | 27 / 25 | what happens (instant lines) | "when a battle starts", "every 10 time(s) a unit Power Flips" | 262 | 52 |
| **While** (state) | 97 / 95 | what must stay true (during lines) | "while in Fever", "while HP is 80%+" | 230 | 49 |
| **Who** | 28 (when), 98 (while) / 26, 96 | whose event or state counts | "a unit" (any party unit), "the leader", this unit | 10 / 11 | 8 / 9 |

Not separate kinds, but part of the trigger:
- **"every N times" / "X% HP"** is the **threshold**, two numbers next to the code (when: cols 30/31; while:
  100/101), ×100000 (10 times = 1000000, 60% = 60000). Same min → max pairs as the numbers editor.
- **Max stacks** (col 34) and the **once / limit** part of the target block (col 40-43) limit how often it fires.
- The **element** a condition names (e.g. Wind) is a column of its own next to the code (e.g. 11, "Green").

So "the leader ⟨wind⟩ unit → every 10 times a unit Power Flips →" is: condition 43 (the leader is element X,
X = wind), when 2 (Power Flips), who 5 (any party unit), threshold 10.

Then the line's **effect** (when: col 47, while: col 109) and its **target** (48 / 110). The client has
687 effect kinds for "when" lines and 422 for "while" lines; CN uses 142 and 35.
Their codes are in [assets/unit_editor/ability_codes.json](../../assets/unit_editor/ability_codes.json) (`instantContent`, `duringContent`),
not listed here.

**Leader skills use the same codes** for every part (same tables in the client), two columns to the left.

**How sure:** the code → name tables are exact (the client's parser, `scripts/research/ability_codes_from_pcode.cjs`
on FFDec p-code of the installed 1.8.1 client; the older decompile in `F:\WF client\cn\decompiled` numbers
them differently, off by 1–4). They agree with everything checked in game: 8 Fever starts, 23 uses skill,
77 every X seconds, 78 heals X HP at once, condition 43 leader element, effects 32 attack up, 206 heal %,
195 healing received, 213 Fever gauge. A code CN never uses may still need columns nobody has filled in yet.

## Conditions ("only if…") — 209 kinds, 20 used

| Code | Client name | In plain words | Ability lines | Leader lines |
|---:|---|---|---:|---:|
| 0 | Always | no condition | 3354 | 973 |
| 3 | MySelf | this unit is element X | 309 |  |
| 2 | Member | N+ units of an element in the party ("X resonates") | 109 | 125 |
| 43 | LeaderCharacter | the leader is element X | 141 |  |
| 8 | HpHigh | HP at or above X% | 21 | 3 |
| 38 | ConditionPiercing | has Pierce | 17 | 2 |
| 186 | NotFever | not in Fever | 7 | 4 |
| 188 | ConditionCountUnique | has N+ stacks of a unit-specific buff | 3 | 6 |
| 187 | ConditionUnique | has a unit-specific buff | 7 |  |
| 205 | HpLowExcludesThreshold | HP below X% | 5 | 1 |
| 9 | HpLow | HP at or below X% | 5 |  |
| 12 | Fever | in Fever | 5 |  |
| 202 | OwnerIsMain | this unit is a main unit | 5 |  |
| 42 | Leader | this unit is the leader | 4 |  |
| 203 | OwnerIsUnison | this unit is a unison unit | 3 |  |
| 39 | ConditionFlying | has Float | 2 |  |
| 87 | Barrier | has a barrier | 2 |  |
| 46 | IsNotLeader | this unit isn't the leader | 1 |  |
| 200 | Revival | has revived | 1 |  |
| 201 | UnisonWithMain | is in unison with a given main unit | 1 |  |

<details><summary>The 189 conditions CN never uses</summary>

1 AlwaysWithoutConditionString, 4 UnisonMyself, 5 ElementVariety, 6 RaceVariety, 7 SpecialityVariety, 10 ComboHigh, 11 ComboLow, 13 Multiball, 14 ConditionAll, 15 ConditionDebuff, 16 ConditionBuff, 17 ConditionAttackPointUp, 18 ConditionAttackPointDown, 19 ConditionSkillDamageUp, 20 ConditionSkillDamageDown, 21 ConditionResistanceUp, 22 ConditionResistanceDown, 23 ConditionDamageCut, 24 ConditionInvincible, 25 ConditionRegeneration, 26 ConditionPoison, 27 ConditionParalysis, 28 ConditionFrozen, 29 ConditionFeverPointUp, 30 ConditionFeverPointDown, 31 ConditionStunifyUp, 32 ConditionStunifyDown, 33 ConditionCharacterSlayerUp, 34 ConditionCharacterSlayerDown, 35 ConditionStanWinceSlayerUp, 36 ConditionStanWinceSlayerDown, 37 ConditionDebuffResistanceUp, 40 ConditionPowerFlipDamageUp, 41 ConditionPowerFlipDamageDown, 44 SecondCharacter, 45 ThirdCharacter, 47 MySelfIsNot, 48 LeaderCharacterIsNot, 49 SecondCharacterIsNot, 50 ThirdCharacterIsNot, 51 ConditionCountAll, 52 ConditionCountDebuff, 53 ConditionCountBuff, 54 ConditionCountAttackPointUp, 55 ConditionCountAttackPointDown, 56 ConditionCountSkillDamageUp, 57 ConditionCountSkillDamageDown, 58 ConditionCountResistanceUp, 59 ConditionCountResistanceDown, 60 ConditionCountDamageCut, 61 ConditionCountInvincible, 62 ConditionCountRegeneration, 63 ConditionCountPoison, 64 ConditionCountParalysis, 65 ConditionCountFrozen, 66 ConditionCountFeverPointUp, 67 ConditionCountFeverPointDown, 68 ConditionCountStunifyUp, 69 ConditionCountStunifyDown, 70 ConditionCountCharacterSlayerUp, 71 ConditionCountCharacterSlayerDown, 72 ConditionCountStanWinceSlayerUp, 73 ConditionCountStanWinceSlayerDown, 74 ConditionCountDebuffResistanceUp, 75 ConditionCountPiercing, 76 ConditionCountFlying, 77 ConditionCountPowerFlipDamageDown, 78 ConditionCountPowerFlipDamageUp, 79 EnemyHigh, 80 EnemyLow, 81 ConditionDirectDamageUp, 82 ConditionDirectDamageDown, 83 ConditionCountDirectDamageUp, 84 ConditionCountDirectDamageDown, 85 ConditionSilence, 86 ConditionCountSilence, 88 ConditionAdditionalDirectAttack, 89 ConditionCountAdditionalDirectAttack, 90 AttackUp, 91 SkillDamageUp, 92 ResistanceAllElementUp, 93 ResistanceRedUp, 94 ResistanceBlueUp, 95 ResistanceYellowUp, 96 ResistanceGreenUp, 97 ResistanceWhiteUp, 98 ResistanceBlackUp, 99 FeverPointUp, 100 StunifyUp, 101 CharacterSlayerUp, 102 StunWinceSlayerUp, 103 DebuffResistanceUp, 104 PowerFlipDamageUp, 105 AttackPointUpSlayerUp, 106 AttackPointDownSlayerUp, 107 DamageCutSlayerUp, 108 InvincibleSlayerUp, 109 RegenerationSlayerUp, 110 PoisonSlayerUp, 111 ParalysisSlayerUp, 112 FrozenSlayerUp, 113 CharacterSlayerUpSlayerUp, 114 CharacterSlayerDownSlayerUp, 115 DebuffResistanceUpSlayerUp, 116 ConditionSpeedup, 117 ConditionCountSpeedup, 118 MaxHpUp, 119 SkillGaugeHigh, 120 SkillGaugeLow, 121 ConditionAccumulationCountAttackPointUp, 122 ConditionAccumulationCountAttackPointDown, 123 ConditionAccumulationCountDirectDamageUp, 124 ConditionAccumulationCountDirectDamageDown, 125 ConditionAccumulationCountSkillDamageUp, 126 ConditionAccumulationCountSkillDamageDown, 127 ConditionAccumulationCountResistanceUp, 128 ConditionAccumulationCountResistanceDown, 129 ConditionAccumulationCountDamageCut, 130 ConditionAccumulationCountPoison, 131 ConditionAccumulationCountFeverPointUp, 132 ConditionAccumulationCountFeverPointDown, 133 ConditionAccumulationCountStunifyUp, 134 ConditionAccumulationCountStunifyDown, 135 ConditionAccumulationCountCharacterSlayerUp, 136 ConditionAccumulationCountCharacterSlayerDown, 137 ConditionAccumulationCountStanWinceSlayerUp, 138 ConditionAccumulationCountStanWinceSlayerDown, 139 ConditionAccumulationCountDebuffResistanceUp, 140 ConditionAccumulationCountAdditionalDirectAttack, 141 ConditionAccumulationCountPowerFlipDamageDown, 142 ConditionAccumulationCountPowerFlipDamageUp, 143 ConditionAccumulationCountSpeedup, 144 ConditionAccumulationCountUnique, 145 OneOfEnemyConditionCountAllCondition, 146 OneOfEnemyConditionCountDebuff, 147 OneOfEnemyConditionCountBuff, 148 OneOfEnemyConditionCountAttackPointUp, 149 OneOfEnemyConditionCountAttackPointDown, 150 OneOfEnemyConditionCountResistanceAllUp, 151 OneOfEnemyConditionCountResistanceRedUp, 152 OneOfEnemyConditionCountResistanceBlueUp, 153 OneOfEnemyConditionCountResistanceYellowUp, 154 OneOfEnemyConditionCountResistanceGreenUp, 155 OneOfEnemyConditionCountResistanceWhiteUp, 156 OneOfEnemyConditionCountResistanceBlackUp, 157 OneOfEnemyConditionCountResistanceAllDown, 158 OneOfEnemyConditionCountResistanceRedDown, 159 OneOfEnemyConditionCountResistanceBlueDown, 160 OneOfEnemyConditionCountResistanceYellowDown, 161 OneOfEnemyConditionCountResistanceGreenDown, 162 OneOfEnemyConditionCountResistanceWhiteDown, 163 OneOfEnemyConditionCountResistanceBlackDown, 164 OneOfEnemyConditionCountDamageCut, 165 OneOfEnemyConditionCountInvincible, 166 OneOfEnemyConditionCountRegeneration, 167 OneOfEnemyConditionCountPoison, 168 OneOfEnemyConditionCountParalysis, 169 OneOfEnemyConditionCountFrozen, 170 OneOfEnemyConditionCountCharacterSlayerUp, 171 OneOfEnemyConditionCountCharacterSlayerDown, 172 OneOfEnemyConditionCountDebuffResistanceUp, 173 SumOfPartyHpHigh, 174 SumOfPartyHpLow, 175 ConditionGuts, 176 ConditionCountGuts, 177 ConditionAdversityUp, 178 ConditionAdversityDown, 179 ConditionCountAdversityUp, 180 ConditionCountAdversityDown, 181 ConditionHealRejection, 182 ConditionCountHealRejection, 183 ConditionBuffRejection, 184 ConditionCountBuffRejection, 185 SpecificMultiball, 189 ConditionCountRedResistanceUp, 190 ConditionCountBlueResistanceUp, 191 ConditionCountYellowResistanceUp, 192 ConditionCountGreenResistanceUp, 193 ConditionCountWhiteResistanceUp, 194 ConditionCountBlackResistanceUp, 195 ConditionAbilityDamageUp, 196 ConditionAbilityDamageDown, 197 ConditionCountAbilityDamageUp, 198 ConditionCountAbilityDamageDown, 199 ConditionAccumulationLowUnique, 204 HpHighExcludesThreshold, 206 SumOfPartyHpHighExcludesThreshold, 207 SumOfPartyHpLowExcludesThreshold, 208 SameElementMember
</details>

## "When" events — 262 kinds, 52 used

| Code | Client name | In plain words | Ability lines | Leader lines |
|---:|---|---|---:|---:|
| 0 | Initial | battle start (lasts the whole battle) ✔ | 1586 | 687 |
| 23 | SkillInvoke | uses its skill ✔ | 569 | 75 |
| 2 | PowerFlip | Power Flips | 184 | 27 |
| 8 | Fever | Fever starts ✔ | 134 | 24 |
| 12 | Combo | combo reaches N | 63 | 15 |
| 70 | ComboDisplay | every N combo | 60 | 7 |
| 18 | Revival | revives | 58 | 8 |
| 21 | DamageCount | takes damage N times | 60 | 2 |
| 57 | Member | party has N+ of an element (at start) | 38 | 19 |
| 19 | HealCount | is healed N times | 48 | 8 |
| 58 | MySelf | this unit is element X (at start) | 42 |  |
| 65 | PowerFlipLv3 | Power Flip Lv 3 | 32 | 8 |
| 10 | EnemyKill | defeats N enemies | 35 | 4 |
| 20 | MemberDirectAttack | hits enemies directly N times | 36 | 1 |
| 6 | BallFlip | flips the ball N times | 27 | 5 |
| 25 | HpLow | HP drops below X% | 29 | 3 |
| 144 | AbilityDamage | deals ability damage N times | 19 | 4 |
| 4 | Dash | dashes | 19 |  |
| 60 | ElementVariety | party has N different elements |  | 18 |
| 77 | ElapsedTime | every X seconds ✔ | 18 |  |
| 30 | ConditionAttackPointUp | gets attack up | 11 |  |
| 107 | SkillHit | its skill hits | 11 |  |
| 24 | SkillMax | skill gauge is full | 9 | 1 |
| 63 | PowerFlipLv1 | Power Flip Lv 1 | 6 | 2 |
| 66 | Leader | this unit is the leader (at start) | 8 |  |
| 9 | MultiballAppear | a multiball appears | 7 |  |
| 184 | FeverEnd | Fever ends | 2 | 5 |
| 197 | CollisionOfMemberAndEnemy | touches an enemy | 6 | 1 |
| 51 | ConditionPiercing | gets Pierce | 5 |  |
| 260 | PowerFlipLv2Low | Power Flip Lv 2 or lower | 2 | 3 |
| 15 | PowerFlipHitLv1High | Power Flip Lv 1+ hits | 2 | 2 |
| 26 | MyselfFlip | this unit flips the ball | 3 | 1 |
| 52 | ConditionFlying | gets Float | 4 |  |
| 78 | HealHigh | heals X HP at once ✔ | 4 |  |
| 143 | DamageByAbility | takes ability damage | 4 |  |
| 13 | BallFlipWithComboHigh | flips with combo N+ | 3 |  |
| 29 | ConditionBuff | gets a buff | 3 |  |
| 139 | Coffin | a unit goes down | 3 |  |
| 236 | ConditionKeepFrameFlying | keeps Float for X | 3 |  |
| 64 | PowerFlipLv2 | Power Flip Lv 2 | 2 |  |
| 102 | EnemyConditionParalysis | an enemy is paralyzed | 2 |  |
| 198 | UnisonWithMain | is in unison with a given main unit | 2 |  |
| 255 | ComboDisplayCount | combo count shown reaches N |  | 2 |
| 11 | EnemyKill1 | defeats N enemies (variant) | 1 |  |
| 28 | ConditionDebuff | gets a debuff | 1 |  |
| 71 | LeaderCharacter | the leader is element X (at start) | 1 |  |
| 76 | FeverPointAddedByAbility | Fever gauge raised by an ability | 1 |  |
| 131 | OneOfEnemyConditionParalysis | one enemy is paralyzed | 1 |  |
| 138 | OneOfEnemyMemberDirectAttack | one enemy is hit directly | 1 |  |
| 141 | SkillGauge | skill gauge reaches X | 1 |  |
| 186 | ContinuousPowerFlipLv1 | Power Flip Lv 1 several times in a row |  | 1 |
| 196 | MyMultiballRemove | its multiball disappears |  | 1 |

<details><summary>The 210 events CN never uses</summary>

1 InstantWithoutConditionString, 3 PowerFlip1, 5 Dash1, 7 BallFlip1, 14 BallFlipWithComboLow, 16 PowerFlipHitLv2High, 17 PowerFlipHitLv3High, 22 DamageCountByFriendlyFire, 27 ConditionAll, 31 ConditionAttackPointDown, 32 ConditionSkillDamageUp, 33 ConditionSkillDamageDown, 34 ConditionResistanceUp, 35 ConditionResistanceDown, 36 ConditionDamageCut, 37 ConditionInvincible, 38 ConditionRegeneration, 39 ConditionPoison, 40 ConditionParalysis, 41 ConditionFrozen, 42 ConditionFeverPointUp, 43 ConditionFeverPointDown, 44 ConditionStunifyUp, 45 ConditionStunifyDown, 46 ConditionCharacterSlayerUp, 47 ConditionCharacterSlayerDown, 48 ConditionStanWinceSlayerUp, 49 ConditionStanWinceSlayerDown, 50 ConditionDebuffResistanceUp, 53 ConditionPowerFlipDamageUp, 54 ConditionPowerFlipDamageDown, 55 ConditionComboBoost, 56 ConditionSwift, 59 UnisonMyself, 61 RaceVariety, 62 SpecialityVariety, 67 ConditionDirectDamageUp, 68 ConditionDirectDamageDown, 69 ConditionSilence, 72 SecondCharacter, 73 ThirdCharacter, 74 ConditionAdditionalDirectAttack, 75 ConditionSpeedup, 79 EnemyConditionAll, 80 EnemyConditionDebuff, 81 EnemyConditionBuff, 82 EnemyConditionAttackPointUp, 83 EnemyConditionAttackPointDown, 84 EnemyConditionResistanceAllUp, 85 EnemyConditionResistanceRedUp, 86 EnemyConditionResistanceBlueUp, 87 EnemyConditionResistanceYellowUp, 88 EnemyConditionResistanceGreenUp, 89 EnemyConditionResistanceWhiteUp, 90 EnemyConditionResistanceBlackUp, 91 EnemyConditionResistanceAllDown, 92 EnemyConditionResistanceRedDown, 93 EnemyConditionResistanceBlueDown, 94 EnemyConditionResistanceYellowDown, 95 EnemyConditionResistanceGreenDown, 96 EnemyConditionResistanceWhiteDown, 97 EnemyConditionResistanceBlackDown, 98 EnemyConditionDamageCut, 99 EnemyConditionInvincible, 100 EnemyConditionRegeneration, 101 EnemyConditionPoison, 103 EnemyConditionFrozen, 104 EnemyConditionCharacterSlayerUp, 105 EnemyConditionCharacterSlayerDown, 106 EnemyConditionDebuffResistanceUp, 108 OneOfEnemyConditionAll, 109 OneOfEnemyConditionDebuff, 110 OneOfEnemyConditionBuff, 111 OneOfEnemyConditionAttackPointUp, 112 OneOfEnemyConditionAttackPointDown, 113 OneOfEnemyConditionResistanceAllUp, 114 OneOfEnemyConditionResistanceRedUp, 115 OneOfEnemyConditionResistanceBlueUp, 116 OneOfEnemyConditionResistanceYellowUp, 117 OneOfEnemyConditionResistanceGreenUp, 118 OneOfEnemyConditionResistanceWhiteUp, 119 OneOfEnemyConditionResistanceBlackUp, 120 OneOfEnemyConditionResistanceAllDown, 121 OneOfEnemyConditionResistanceRedDown, 122 OneOfEnemyConditionResistanceBlueDown, 123 OneOfEnemyConditionResistanceYellowDown, 124 OneOfEnemyConditionResistanceGreenDown, 125 OneOfEnemyConditionResistanceWhiteDown, 126 OneOfEnemyConditionResistanceBlackDown, 127 OneOfEnemyConditionDamageCut, 128 OneOfEnemyConditionInvincible, 129 OneOfEnemyConditionRegeneration, 130 OneOfEnemyConditionPoison, 132 OneOfEnemyConditionFrozen, 133 OneOfEnemyConditionCharacterSlayerUp, 134 OneOfEnemyConditionCharacterSlayerDown, 135 OneOfEnemyConditionDebuffResistanceUp, 136 OneOfEnemySkillHit, 137 Barrier, 140 EnemyConditionCancelBuff, 142 OneOfEnemyDamageCount, 145 IsNotLeader, 146 MySelfIsNot, 147 LeaderCharacterIsNot, 148 SecondCharacterIsNot, 149 ThirdCharacterIsNot, 150 ConditionAccumulationCountAttackPointUp, 151 ConditionAccumulationCountAttackPointDown, 152 ConditionAccumulationCountDirectDamageUp, 153 ConditionAccumulationCountDirectDamageDown, 154 ConditionAccumulationCountSkillDamageUp, 155 ConditionAccumulationCountSkillDamageDown, 156 ConditionAccumulationCountResistanceUp, 157 ConditionAccumulationCountResistanceDown, 158 ConditionAccumulationCountDamageCut, 159 ConditionAccumulationCountPoison, 160 ConditionAccumulationCountFeverPointUp, 161 ConditionAccumulationCountFeverPointDown, 162 ConditionAccumulationCountStunifyUp, 163 ConditionAccumulationCountStunifyDown, 164 ConditionAccumulationCountCharacterSlayerUp, 165 ConditionAccumulationCountCharacterSlayerDown, 166 ConditionAccumulationCountStanWinceSlayerUp, 167 ConditionAccumulationCountStanWinceSlayerDown, 168 ConditionAccumulationCountDebuffResistanceUp, 169 ConditionAccumulationCountAdditionalDirectAttack, 170 ConditionAccumulationCountPowerFlipDamageUp, 171 ConditionAccumulationCountPowerFlipDamageDown, 172 ConditionAccumulationCountSpeedup, 173 ConditionAccumulationCountUnique, 174 ConditionGuts, 175 ConditionAdversityUp, 176 ConditionAdversityDown, 177 ConditionHealRejection, 178 ConditionBuffRejection, 179 SpecificMultiballAppear, 180 OneOfEnemyPowerFlipHitLv1, 181 OneOfEnemyPowerFlipHitLv2, 182 OneOfEnemyPowerFlipHitLv3, 183 OneOfEnemyPowerFlipHitLvAny, 185 ConditionUnique, 187 ContinuousPowerFlipLv2, 188 ContinuousPowerFlipLv3, 189 InvokeGuts, 190 ConditionAbilityDamageUp, 191 ConditionAbilityDamageDown, 192 ConditionAccumulationCountAbilityDamageUp, 193 ConditionAccumulationCountAbilityDamageDown, 194 MultiballRemove, 195 SpecificMultiballRemove, 199 ConditionKeepFrameAll, 200 ConditionKeepFrameDebuff, 201 ConditionKeepFrameBuff, 202 ConditionKeepFrameAttackPointUp, 203 ConditionKeepFrameAttackPointDown, 204 ConditionKeepFrameSkillDamageUp, 205 ConditionKeepFrameSkillDamageDown, 206 ConditionKeepFrameResistanceUp, 207 ConditionKeepFrameResistanceDown, 208 ConditionKeepFrameDamageCut, 209 ConditionKeepFrameInvincible, 210 ConditionKeepFrameRegeneration, 211 ConditionKeepFramePoison, 212 ConditionKeepFrameParalysis, 213 ConditionKeepFrameFrozen, 214 ConditionKeepFrameFeverPointUp, 215 ConditionKeepFrameFeverPointDown, 216 ConditionKeepFrameStunifyUp, 217 ConditionKeepFrameStunifyDown, 218 ConditionKeepFrameCharacterSlayerUp, 219 ConditionKeepFrameCharacterSlayerDown, 220 ConditionKeepFrameStanWinceSlayerUp, 221 ConditionKeepFrameStanWinceSlayerDown, 222 ConditionKeepFrameDebuffResistanceUp, 223 ConditionKeepFrameDirectDamageUp, 224 ConditionKeepFrameDirectDamageDown, 225 ConditionKeepFrameSilence, 226 ConditionKeepFrameAdditionalDirectAttack, 227 ConditionKeepFrameGuts, 228 ConditionKeepFrameAdversityUp, 229 ConditionKeepFrameAdversityDown, 230 ConditionKeepFrameHealRejection, 231 ConditionKeepFrameBuffRejection, 232 ConditionKeepFrameUnique, 233 ConditionKeepFrameAbilityDamageUp, 234 ConditionKeepFrameAbilityDamageDown, 235 ConditionKeepFramePiercing, 237 ConditionKeepFramePowerFlipDamageUp, 238 ConditionKeepFramePowerFlipDamageDown, 239 ConditionKeepFrameComboBoost, 240 ConditionKeepFrameSpeedup, 241 ConditionKeepFrameSwift, 242 ConditionFixedSpeedUp, 243 ConditionFixedSpeedDown, 244 ConditionAccumulationCountFixedSpeedUp, 245 ConditionAccumulationCountFixedSpeedDown, 246 ConditionKeepFrameFixedSpeedUp, 247 ConditionKeepFrameFixedSpeedDown, 248 FeverFrame, 249 ConditionSkillGaugeChargingUp, 250 ConditionSkillGaugeChargingDown, 251 ConditionAccumulationCountSkillGaugeChargingUp, 252 ConditionAccumulationCountSkillGaugeChargingDown, 253 ConditionKeepFrameSkillGaugeChargingUp, 254 ConditionKeepFrameSkillGaugeChargingDown, 256 AttackCountOfFriendlyFire, 257 SameElementMember, 258 HpLowExcludesThreshold, 259 PowerFlipLv2High, 261 ExcessSkillGauge
</details>

## "While" states — 230 kinds, 49 used

| Code | Client name | In plain words | Ability lines | Leader lines |
|---:|---|---|---:|---:|
| 0 | HpHigh | HP at or above X% ✔ | 87 | 16 |
| 1 | HpLow | HP at or below X% | 82 | 16 |
| 30 | ConditionPiercing | has Pierce | 80 | 18 |
| 4 | Fever | in Fever ✔ | 70 | 16 |
| 109 | HpIncrease | HP rises (while healed) | 55 | 12 |
| 209 | CountSpecificMultiball | N multiballs of a kind are out | 44 | 14 |
| 38 | ConditionCountAttackPointUp | has N+ attack up buffs | 44 | 8 |
| 31 | ConditionFlying | has Float | 35 | 14 |
| 110 | HpDecrease | HP falls | 30 | 8 |
| 2 | ComboHigh | combo N+ | 29 | 8 |
| 134 | ConditionAccumulationCountUnique | unit-specific counter at N+ | 24 | 7 |
| 136 | OneOfEnemyConditionCountDebuff | an enemy has N+ debuffs | 27 | 4 |
| 9 | ConditionAttackPointUp | has attack up | 28 | 1 |
| 227 | HpLowExcludesThreshold | HP below X% | 20 | 8 |
| 37 | ConditionCountBuff | has N+ buffs | 22 | 5 |
| 72 | Barrier | has a barrier | 15 | 3 |
| 5 | Multiball | multiball is out | 14 |  |
| 194 | ConditionCountUnique | N+ stacks of a unit-specific buff | 9 | 2 |
| 62 | ConditionCountPowerFlipDamageUp | N+ Power Flip damage up buffs | 9 | 1 |
| 8 | ConditionBuff | has a buff | 8 | 1 |
| 64 | EnemyHigh | enemy count N+ | 8 | 1 |
| 73 | ConditionAdditionalDirectAttack | has an extra direct attack buff | 7 |  |
| 214 | ConditionFixedSpeedUp | has fixed speed up | 5 | 1 |
| 32 | ConditionPowerFlipDamageUp | has Power Flip damage up | 5 |  |
| 75 | AttackUp | attack is up | 5 |  |
| 204 | CountDirectAttackDamageUp | N+ direct damage up | 4 | 1 |
| 40 | ConditionCountSkillDamageUp | N+ skill damage up buffs | 3 | 1 |
| 203 | CountSkillDamageUp | N+ skill damage up | 3 | 1 |
| 207 | ConditionAccumulationLowUnique | unit-specific counter below N | 4 |  |
| 17 | ConditionRegeneration | has regeneration | 3 |  |
| 187 | ConditionCountBlueResistanceUp | N+ water resistance up | 3 |  |
| 213 | Revival | has revived | 2 | 1 |
| 7 | ConditionDebuff | has a debuff | 2 |  |
| 36 | ConditionCountDebuff | has N+ debuffs | 2 |  |
| 85 | ResistanceBlackUp | dark resistance up | 2 |  |
| 91 | PowerFlipDamageUp | Power Flip damage up | 1 | 1 |
| 104 | ConditionSpeedup | has speed up | 2 |  |
| 195 | ContinuousPowerFlipLv1 | Power Flip Lv 1 in a row | 2 |  |
| 210 | PartyCoffin | a party unit is down | 2 |  |
| 11 | ConditionSkillDamageUp | has skill damage up | 1 |  |
| 27 | ConditionStanWinceSlayerUp | has stun/wince slayer up | 1 |  |
| 34 | ConditionSwift | has swift | 1 |  |
| 80 | ResistanceRedUp | fire resistance up | 1 |  |
| 82 | ResistanceYellowUp | thunder resistance up | 1 |  |
| 107 | SkillGaugeHigh | skill gauge X%+ | 1 |  |
| 152 | OneOfEnemyConditionCountResistanceWhiteDown | an enemy has N+ light resistance down |  | 1 |
| 178 | ConditionCountAdversityUp | N+ adversity up | 1 |  |
| 192 | OneOfEnemyConditionCountUnique | an enemy has N+ of a unit-specific debuff | 1 |  |
| 208 | CountMultiball | N multiballs out |  | 1 |

<details><summary>The 181 states CN never uses</summary>

3 ComboLow, 6 ConditionAll, 10 ConditionAttackPointDown, 12 ConditionSkillDamageDown, 13 ConditionResistanceUp, 14 ConditionResistanceDown, 15 ConditionDamageCut, 16 ConditionInvincible, 18 ConditionPoison, 19 ConditionParalysis, 20 ConditionFrozen, 21 ConditionFeverPointUp, 22 ConditionFeverPointDown, 23 ConditionStunifyUp, 24 ConditionStunifyDown, 25 ConditionCharacterSlayerUp, 26 ConditionCharacterSlayerDown, 28 ConditionStanWinceSlayerDown, 29 ConditionDebuffResistanceUp, 33 ConditionPowerFlipDamageDown, 35 ConditionCountAll, 39 ConditionCountAttackPointDown, 41 ConditionCountSkillDamageDown, 42 ConditionCountResistanceUp, 43 ConditionCountResistanceDown, 44 ConditionCountDamageCut, 45 ConditionCountInvincible, 46 ConditionCountRegeneration, 47 ConditionCountPoison, 48 ConditionCountParalysis, 49 ConditionCountFrozen, 50 ConditionCountFeverPointUp, 51 ConditionCountFeverPointDown, 52 ConditionCountStunifyUp, 53 ConditionCountStunifyDown, 54 ConditionCountCharacterSlayerUp, 55 ConditionCountCharacterSlayerDown, 56 ConditionCountStanWinceSlayerUp, 57 ConditionCountStanWinceSlayerDown, 58 ConditionCountDebuffResistanceUp, 59 ConditionCountPiercing, 60 ConditionCountFlying, 61 ConditionCountPowerFlipDamageDown, 63 ConditionCountSwift, 65 EnemyLow, 66 ConditionDirectDamageUp, 67 ConditionDirectDamageDown, 68 ConditionCountDirectDamageUp, 69 ConditionCountDirectDamageDown, 70 ConditionSilence, 71 ConditionCountSilence, 74 ConditionCountAdditionalDirectAttack, 76 SkillDamageUp, 77 DirectAttackDamageUp, 78 AbilityDamageUp, 79 ResistanceAllElementUp, 81 ResistanceBlueUp, 83 ResistanceGreenUp, 84 ResistanceWhiteUp, 86 FeverPointUp, 87 StunifyUp, 88 CharacterSlayerUp, 89 StunWinceSlayerUp, 90 DebuffResistanceUp, 92 SpeedUp, 93 AttackPointUpSlayerUp, 94 AttackPointDownSlayerUp, 95 DamageCutSlayerUp, 96 InvincibleSlayerUp, 97 RegenerationSlayerUp, 98 PoisonSlayerUp, 99 ParalysisSlayerUp, 100 FrozenSlayerUp, 101 CharacterSlayerUpSlayerUp, 102 CharacterSlayerDownSlayerUp, 103 DebuffResistanceUpSlayerUp, 105 ConditionCountSpeedup, 106 MaxHpUp, 108 SkillGaugeLow, 111 ConditionAccumulationCountAttackPointUp, 112 ConditionAccumulationCountAttackPointDown, 113 ConditionAccumulationCountDirectDamageUp, 114 ConditionAccumulationCountDirectDamageDown, 115 ConditionAccumulationCountSkillDamageUp, 116 ConditionAccumulationCountSkillDamageDown, 117 ConditionAccumulationCountResistanceUp, 118 ConditionAccumulationCountResistanceDown, 119 ConditionAccumulationCountDamageCut, 120 ConditionAccumulationCountPoison, 121 ConditionAccumulationCountFeverPointUp, 122 ConditionAccumulationCountFeverPointDown, 123 ConditionAccumulationCountStunifyUp, 124 ConditionAccumulationCountStunifyDown, 125 ConditionAccumulationCountCharacterSlayerUp, 126 ConditionAccumulationCountCharacterSlayerDown, 127 ConditionAccumulationCountStanWinceSlayerUp, 128 ConditionAccumulationCountStanWinceSlayerDown, 129 ConditionAccumulationCountDebuffResistanceUp, 130 ConditionAccumulationCountAdditionalDirectAttack, 131 ConditionAccumulationCountPowerFlipDamageDown, 132 ConditionAccumulationCountPowerFlipDamageUp, 133 ConditionAccumulationCountSpeedup, 135 OneOfEnemyConditionCountAllCondition, 137 OneOfEnemyConditionCountBuff, 138 OneOfEnemyConditionCountAttackPointUp, 139 OneOfEnemyConditionCountAttackPointDown, 140 OneOfEnemyConditionCountResistanceAllUp, 141 OneOfEnemyConditionCountResistanceRedUp, 142 OneOfEnemyConditionCountResistanceBlueUp, 143 OneOfEnemyConditionCountResistanceYellowUp, 144 OneOfEnemyConditionCountResistanceGreenUp, 145 OneOfEnemyConditionCountResistanceWhiteUp, 146 OneOfEnemyConditionCountResistanceBlackUp, 147 OneOfEnemyConditionCountResistanceAllDown, 148 OneOfEnemyConditionCountResistanceRedDown, 149 OneOfEnemyConditionCountResistanceBlueDown, 150 OneOfEnemyConditionCountResistanceYellowDown, 151 OneOfEnemyConditionCountResistanceGreenDown, 153 OneOfEnemyConditionCountResistanceBlackDown, 154 OneOfEnemyConditionCountDamageCut, 155 OneOfEnemyConditionCountInvincible, 156 OneOfEnemyConditionCountRegeneration, 157 OneOfEnemyConditionCountPoison, 158 OneOfEnemyConditionCountParalysis, 159 OneOfEnemyConditionCountFrozen, 160 OneOfEnemyConditionCountCharacterSlayerUp, 161 OneOfEnemyConditionCountCharacterSlayerDown, 162 OneOfEnemyConditionCountDebuffResistanceUp, 163 OneOfEnemyAttackDown, 164 OneOfEnemyResistanceAllElementDown, 165 OneOfEnemyResistanceRedDown, 166 OneOfEnemyResistanceBlueDown, 167 OneOfEnemyResistanceYellowDown, 168 OneOfEnemyResistanceGreenDown, 169 OneOfEnemyResistanceWhiteDown, 170 OneOfEnemyResistanceBlackDown, 171 OneOfEnemyConditionAccumulationCountUnique, 172 SumOfPartyHpHigh, 173 SumOfPartyHpLow, 174 ConditionGuts, 175 ConditionCountGuts, 176 ConditionAdversityUp, 177 ConditionAdversityDown, 179 ConditionCountAdversityDown, 180 ConditionHealRejection, 181 ConditionCountHealRejection, 182 ConditionBuffRejection, 183 ConditionCountBuffRejection, 184 SpecificMultiball, 185 ConditionComboBoost, 186 ConditionCountRedResistanceUp, 188 ConditionCountYellowResistanceUp, 189 ConditionCountGreenResistanceUp, 190 ConditionCountWhiteResistanceUp, 191 ConditionCountBlackResistanceUp, 193 NotFever, 196 ContinuousPowerFlipLv2, 197 ContinuousPowerFlipLv3, 198 ConditionAbilityDamageUp, 199 ConditionAbilityDamageDown, 200 ConditionCountAbilityDamageUp, 201 ConditionCountAbilityDamageDown, 202 CountAttackUp, 205 CountPowerFlipDamageUp, 206 CountAbilityDamageUp, 211 MyMultiball, 212 MyMultiballLow, 215 ConditionFixedSpeedDown, 216 ConditionCountFixedSpeedUp, 217 ConditionCountFixedSpeedDown, 218 ConditionAccumulationCountFixedSpeedUp, 219 ConditionAccumulationCountFixedSpeedDown, 220 ConditionSkillGaugeChargingUp, 221 ConditionSkillGaugeChargingDown, 222 ConditionCountSkillGaugeChargingUp, 223 ConditionCountSkillGaugeChargingDown, 224 ConditionAccumulationCountSkillGaugeChargingUp, 225 ConditionAccumulationCountSkillGaugeChargingDown, 226 HpHighExcludesThreshold, 228 SumOfPartyHpHighExcludesThreshold, 229 SumOfPartyHpLowExcludesThreshold
</details>

## "Who" — for "when" lines (10 kinds) and "while" lines (11)

When:

| Code | Client name | In plain words | Ability lines | Leader lines |
|---:|---|---|---:|---:|
| 0 | Myself | this unit | 669 | 38 |
| 7 | TotalOfParty | the party, counted together | 107 | 33 |
| 5 | OneOfParty | any party unit | 72 | 32 |
| 1 | Leader | the leader | 11 |  |
| 6 | TotalOfExceptMyself | other units, counted together | 7 |  |
| 4 | OneOfExceptMyself | any other party unit | 3 |  |
| 8 | PreconditionTriggerPuller | the same unit as the condition | 3 |  |
| 3 | Third | 3rd unit | 1 |  |

While:

| Code | Client name | In plain words | Ability lines | Leader lines |
|---:|---|---|---:|---:|
| 0 | Myself | this unit | 303 | 19 |
| 5 | OneOfParty | any party unit | 69 | 54 |
| 9 | SumOfParty | the party, summed | 64 | 15 |
| 1 | Leader | the leader | 14 |  |
| 7 | TotalOfParty | the party, counted together | 10 | 3 |
| 10 | OneOfMultiball | any multiball | 5 |  |
| 4 | OneOfExceptMyself | any other party unit | 3 |  |
| 3 | Third | 3rd unit | 1 |  |
| 6 | TotalOfExceptMyself | other units, counted together | 1 |  |
