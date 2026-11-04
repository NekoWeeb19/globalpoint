# GlobalPoint routes

Every route the GlobalPoint server answers, listed by the server itself. **Generated** by
`scripts/gen_routes_doc.cjs`; don't edit by hand. Rebuild it after adding or changing routes:

```
npx tsc -p .
node scripts/gen_routes_doc.cjs
```

For the global app's captured official traffic and upstream's 2024 status list, see
[global/routes.md](global/routes.md).

**Columns**
- **App:** `both` = the global and CN apps share the handler; `CN` = only the CN app calls it;
  `global` = only the global app (Kakao's login/platform services).
- **Notes:** `CN-specific reply` = the handler itself answers the CN app differently (many more
  routes differ inside the shared code they call, which this can't see); `fixed reply
  (placeholder)` = always the same small answer, enough for the game to carry on.
- **Seen from CN app:** the CN app called it in this PC's request log (`logs/cn_requests.log`).
  Blank doesn't mean unused: only what was played on this PC is logged.

## Game API (146 endpoints)

The global app calls `/latest/api/index.php/<endpoint>`. The CN app calls `/cn/api/index.php/<endpoint>`, which
the server rewrites to the same path, so both apps share these handlers. Replies to the CN app are
also converted to its format (`adaptCnReply` in `src/lib/cnClient.ts`).

| Endpoint | Method | App | Source | Notes | Seen from CN app |
|---|---|---|---|---|---|
| `/active_mission/receive` | POST | both | [api/activeMission.ts](../src/routes/api/activeMission.ts) |  | yes |
| `/asset/get_path` | POST | both | [api/asset.ts](../src/routes/api/asset.ts) | CN-specific reply | yes |
| `/asset/version_info` | POST | both | [api/asset.ts](../src/routes/api/asset.ts) | CN-specific reply | yes |
| `/assetintitle/version_info_in_title` | POST | CN | [api/cn.ts](../src/routes/api/cn.ts) |  | yes |
| `/attention/check` | POST | both | [api/attention.ts](../src/routes/api/attention.ts) |  | yes |
| `/bonus/shown` | POST | both | [api/stubs.ts](../src/routes/api/stubs.ts) | fixed reply, plus saves state | yes |
| `/box_gacha/close` | POST | both | [api/boxGacha.ts](../src/routes/api/boxGacha.ts) |  |  |
| `/box_gacha/exec` | POST | both | [api/boxGacha.ts](../src/routes/api/boxGacha.ts) |  | yes |
| `/box_gacha/get_box_list` | POST | both | [api/boxGacha.ts](../src/routes/api/boxGacha.ts) |  | yes |
| `/carnival_event/get_party` | POST | both | [api/carnivalEvent.ts](../src/routes/api/carnivalEvent.ts) |  | yes |
| `/carnival_event/index` | POST | both | [api/carnivalEvent.ts](../src/routes/api/carnivalEvent.ts) |  | yes |
| `/channels/channel_leiting_pay/query_purcharge` | POST | CN | [api/cn.ts](../src/routes/api/cn.ts) | fixed reply (placeholder) |  |
| `/channels/channel_leiting_pay/query_unfinish_order` | POST | CN | [api/cn.ts](../src/routes/api/cn.ts) | fixed reply (placeholder) | yes |
| `/channels/channel_leiting_pay/set_unfinish_order_error` | POST | CN | [api/cn.ts](../src/routes/api/cn.ts) | fixed reply (placeholder) |  |
| `/channels/channel_leiting_pay/set_unfinish_order_status` | POST | CN | [api/cn.ts](../src/routes/api/cn.ts) | fixed reply (placeholder) |  |
| `/channels/channel_leiting/leiting_antiaddiction_login` | POST | CN | [api/cn.ts](../src/routes/api/cn.ts) | fixed reply (placeholder) | yes |
| `/channels/channel_leiting/leiting_antiaddiction_logout` | POST | CN | [api/cn.ts](../src/routes/api/cn.ts) | fixed reply (placeholder) |  |
| `/channels/channel_leiting/leiting_login` | POST | CN | [api/cn.ts](../src/routes/api/cn.ts) |  | yes |
| `/channels/channel_leiting/leiting_update` | POST | CN | [api/cn.ts](../src/routes/api/cn.ts) | fixed reply (placeholder) |  |
| `/character/add_character_from_town` | POST | both | [api/character.ts](../src/routes/api/character.ts) |  |  |
| `/character/awake_mana_node` | POST | both | [api/character.ts](../src/routes/api/character.ts) |  | yes |
| `/character/bulk_over_limit` | POST | both | [api/character.ts](../src/routes/api/character.ts) |  |  |
| `/character/learn_mana_node` | POST | both | [api/character.ts](../src/routes/api/character.ts) |  | yes |
| `/character/open_mana_board` | POST | both | [api/character.ts](../src/routes/api/character.ts) |  | yes |
| `/character/over_limit` | POST | both | [api/character.ts](../src/routes/api/character.ts) |  | yes |
| `/character/receive_bond_token` | POST | both | [api/character.ts](../src/routes/api/character.ts) |  | yes |
| `/character/set_illustration_settings` | POST | both | [api/character.ts](../src/routes/api/character.ts) |  |  |
| `/comic/get_list` | POST | both | [api/comic.ts](../src/routes/api/comic.ts) |  | yes |
| `/comic/image` | GET | both | [api/comic.ts](../src/routes/api/comic.ts) |  | yes |
| `/contents_guide/start` | POST | CN | [api/cn.ts](../src/routes/api/cn.ts) |  | yes |
| `/encyclopedia/index` | POST | both | [api/carnivalEvent.ts](../src/routes/api/carnivalEvent.ts) |  | yes |
| `/encyclopedia/read_keyword` | POST | both | [api/encyclopedia.ts](../src/routes/api/encyclopedia.ts) |  |  |
| `/episode_trial_reading/finish` | POST | CN | [api/cn.ts](../src/routes/api/cn.ts) | fixed reply (placeholder) | yes |
| `/equipment/bulk_sell_stack` | POST | both | [api/equipment.ts](../src/routes/api/equipment.ts) |  | yes |
| `/equipment/bulk_upgrade` | POST | both | [api/equipment.ts](../src/routes/api/equipment.ts) |  | yes |
| `/equipment/sell_equipment` | POST | both | [api/equipment.ts](../src/routes/api/equipment.ts) |  |  |
| `/equipment/sell_stack` | POST | both | [api/equipment.ts](../src/routes/api/equipment.ts) |  | yes |
| `/equipment/set_protection` | POST | both | [api/equipment.ts](../src/routes/api/equipment.ts) |  | yes |
| `/equipment/upgrade` | POST | both | [api/equipment.ts](../src/routes/api/equipment.ts) |  | yes |
| `/event/raid/battle/start` | POST | both | [api/raidEvent.ts](../src/routes/api/raidEvent.ts) |  | yes |
| `/event/raid/get_boss` | POST | both | [api/raidEvent.ts](../src/routes/api/raidEvent.ts) |  |  |
| `/event/raid/party` | POST | both | [api/raidEvent.ts](../src/routes/api/raidEvent.ts) |  | yes |
| `/event/raid/summary` | POST | both | [api/raidEvent.ts](../src/routes/api/raidEvent.ts) |  | yes |
| `/event/rush/aggregated_time` | POST | both | [api/rushEvent.ts](../src/routes/api/rushEvent.ts) |  |  |
| `/event/rush/battle/start` | POST | both | [api/raidEvent.ts](../src/routes/api/raidEvent.ts) |  | yes |
| `/event/rush/party` | POST | both | [api/raidEvent.ts](../src/routes/api/raidEvent.ts) |  | yes |
| `/event/rush/ranking` | POST | both | [api/rushEvent.ts](../src/routes/api/rushEvent.ts) |  |  |
| `/event/rush/ranking/played_party` | POST | both | [api/rushEvent.ts](../src/routes/api/rushEvent.ts) |  |  |
| `/event/rush/reset` | POST | both | [api/rushEvent.ts](../src/routes/api/rushEvent.ts) |  |  |
| `/event/rush/select_folder` | POST | both | [api/rushEvent.ts](../src/routes/api/rushEvent.ts) |  | yes |
| `/event/rush/summary` | POST | both | [api/raidEvent.ts](../src/routes/api/raidEvent.ts) |  | yes |
| `/ex_boost/draw` | POST | both | [api/exBoost.ts](../src/routes/api/exBoost.ts) |  | yes |
| `/ex_boost/first_draw` | POST | both | [api/exBoost.ts](../src/routes/api/exBoost.ts) |  | yes |
| `/ex_boost/select` | POST | both | [api/exBoost.ts](../src/routes/api/exBoost.ts) |  | yes |
| `/exchange/bond_token` | POST | both | [api/exchange.ts](../src/routes/api/exchange.ts) |  |  |
| `/exchange/get_bond_token_exchange_list` | POST | both | [api/exchange.ts](../src/routes/api/exchange.ts) |  |  |
| `/exchange/star_crumb` | POST | both | [api/exchange.ts](../src/routes/api/exchange.ts) |  | yes |
| `/expod/bulk_stack_to_exp` | POST | both | [api/expod.ts](../src/routes/api/expod.ts) |  |  |
| `/expod/inject_exp` | POST | both | [api/expod.ts](../src/routes/api/expod.ts) |  | yes |
| `/expod/stack_to_exp` | POST | both | [api/expod.ts](../src/routes/api/expod.ts) |  |  |
| `/follow/lists` | POST | both | [api/stubs.ts](../src/routes/api/stubs.ts) | fixed reply (placeholder) | yes |
| `/gacha/exchange_character` | POST | both | [api/gacha.ts](../src/routes/api/gacha.ts) |  |  |
| `/gacha/exchange_equipment` | POST | both | [api/gacha.ts](../src/routes/api/gacha.ts) |  |  |
| `/gacha/exec` | POST | both | [api/boxGacha.ts](../src/routes/api/boxGacha.ts) |  | yes |
| `/growth_fund/receive_fund_bonus` | POST | both | [api/growthFund.ts](../src/routes/api/growthFund.ts) |  | yes |
| `/history/receive` | POST | both | [api/activeMission.ts](../src/routes/api/activeMission.ts) |  | yes |
| `/history/score_attack_event_battle` | POST | both | [api/history.ts](../src/routes/api/history.ts) |  |  |
| `/how_to_get/get_list` | POST | both | [api/shop.ts](../src/routes/api/shop.ts) |  | yes |
| `/item/sell` | POST | both | [api/item.ts](../src/routes/api/item.ts) |  | yes |
| `/item/use_item` | POST | both | [api/item.ts](../src/routes/api/item.ts) |  | yes |
| `/load` | POST | both | [api/index.ts](../src/routes/api/index.ts) | CN-specific reply | yes |
| `/lounge/get_list` | POST | both | [api/stubs.ts](../src/routes/api/stubs.ts) | fixed reply (placeholder) |  |
| `/mail/index` | POST | both | [api/carnivalEvent.ts](../src/routes/api/carnivalEvent.ts) |  | yes |
| `/mail/receive` | POST | both | [api/activeMission.ts](../src/routes/api/activeMission.ts) |  | yes |
| `/mail/receive_all` | POST | both | [api/mail.ts](../src/routes/api/mail.ts) |  |  |
| `/mission/get_mission_progress` | POST | both | [api/mission.ts](../src/routes/api/mission.ts) |  | yes |
| `/mission/update_mission_progress` | POST | both | [api/mission.ts](../src/routes/api/mission.ts) |  | yes |
| `/multi_battle_quest/abort` | POST | both | [api/multiBattleQuest.ts](../src/routes/api/multiBattleQuest.ts) |  | yes |
| `/multi_battle_quest/create_room` | POST | both | [api/multiBattleQuest.ts](../src/routes/api/multiBattleQuest.ts) |  | yes |
| `/multi_battle_quest/disband_room` | POST | both | [api/multiBattleQuest.ts](../src/routes/api/multiBattleQuest.ts) |  | yes |
| `/multi_battle_quest/finish` | POST | both | [api/multiBattleQuest.ts](../src/routes/api/multiBattleQuest.ts) |  | yes |
| `/multi_battle_quest/get_rooms` | POST | both | [api/multiBattleQuest.ts](../src/routes/api/multiBattleQuest.ts) |  | yes |
| `/multi_battle_quest/play_continue` | POST | both | [api/multiBattleQuest.ts](../src/routes/api/multiBattleQuest.ts) |  |  |
| `/multi_battle_quest/prepare` | POST | both | [api/multiBattleQuest.ts](../src/routes/api/multiBattleQuest.ts) |  | yes |
| `/multi_battle_quest/restore_room` | POST | both | [api/multiBattleQuest.ts](../src/routes/api/multiBattleQuest.ts) |  | yes |
| `/multi_battle_quest/select_room` | POST | both | [api/multiBattleQuest.ts](../src/routes/api/multiBattleQuest.ts) |  | yes |
| `/multi_battle_quest/share_room` | POST | both | [api/multiBattleQuest.ts](../src/routes/api/multiBattleQuest.ts) |  | yes |
| `/multi_battle_quest/start` | POST | both | [api/multiBattleQuest.ts](../src/routes/api/multiBattleQuest.ts) |  | yes |
| `/multi_battle_quest/summon` | POST | both | [api/multiBattleQuest.ts](../src/routes/api/multiBattleQuest.ts) |  | yes |
| `/news/get_info` | POST | both | [api/news.ts](../src/routes/api/news.ts) |  |  |
| `/news/get_system_info` | POST | both | [api/news.ts](../src/routes/api/news.ts) |  |  |
| `/news/index` | POST | CN | [api/cn.ts](../src/routes/api/cn.ts) |  | yes |
| `/news/system_index` | POST | CN | [api/cn.ts](../src/routes/api/cn.ts) |  |  |
| `/option/update` | POST | both | [api/option.ts](../src/routes/api/option.ts) |  | yes |
| `/option/update_in_battle` | POST | both | [api/option.ts](../src/routes/api/option.ts) |  |  |
| `/party_group/edit` | POST | both | [api/party.ts](../src/routes/api/party.ts) |  |  |
| `/party/check_word` | POST | both | [api/party.ts](../src/routes/api/party.ts) |  |  |
| `/party/edit` | POST | both | [api/party.ts](../src/routes/api/party.ts) |  | yes |
| `/party/publish` | POST | both | [api/party.ts](../src/routes/api/party.ts) |  | yes |
| `/Pass_card/get_pass_card` | POST | both | [api/passCard.ts](../src/routes/api/passCard.ts) |  | yes |
| `/Pass_card/receive_all` | POST | both | [api/mail.ts](../src/routes/api/mail.ts) |  | yes |
| `/payment/detail_items` | POST | both | [api/payment.ts](../src/routes/api/payment.ts) |  | yes |
| `/payment/item_list` | POST | both | [api/payment.ts](../src/routes/api/payment.ts) |  |  |
| `/profile/get_degree_list` | POST | both | [api/profile.ts](../src/routes/api/profile.ts) |  | yes |
| `/profile/get_last_login_region` | POST | both | [api/profile.ts](../src/routes/api/profile.ts) |  | yes |
| `/profile/get_my_profile` | POST | both | [api/profile.ts](../src/routes/api/profile.ts) |  | yes |
| `/profile/get_profile` | POST | both | [api/profile.ts](../src/routes/api/profile.ts) |  |  |
| `/profile/rename` | POST | both | [api/profile.ts](../src/routes/api/profile.ts) |  |  |
| `/profile/update_comment` | POST | both | [api/profile.ts](../src/routes/api/profile.ts) |  | yes |
| `/profile/update_degree` | POST | both | [api/profile.ts](../src/routes/api/profile.ts) |  | yes |
| `/profile/update_profile_settings` | POST | both | [api/profile.ts](../src/routes/api/profile.ts) |  |  |
| `/quest/get_recent_other_player_party` | POST | both | [api/quest.ts](../src/routes/api/quest.ts) |  |  |
| `/ranking_event/get_summary` | POST | both | [api/rankingEvent.ts](../src/routes/api/rankingEvent.ts) |  | yes |
| `/ranking_event/receive_reward` | POST | both | [api/rankingEvent.ts](../src/routes/api/rankingEvent.ts) |  |  |
| `/reproduce/post` | POST | both | [api/reproduce.ts](../src/routes/api/reproduce.ts) |  |  |
| `/shop/buy` | POST | both | [api/shop.ts](../src/routes/api/shop.ts) | CN-specific reply | yes |
| `/shop/get_sales_list` | POST | both | [api/shop.ts](../src/routes/api/shop.ts) |  | yes |
| `/single_battle_quest/abort` | POST | both | [api/multiBattleQuest.ts](../src/routes/api/multiBattleQuest.ts) |  | yes |
| `/single_battle_quest/finish` | POST | both | [api/multiBattleQuest.ts](../src/routes/api/multiBattleQuest.ts) |  | yes |
| `/single_battle_quest/play_continue` | POST | both | [api/multiBattleQuest.ts](../src/routes/api/multiBattleQuest.ts) |  |  |
| `/single_battle_quest/start` | POST | both | [api/multiBattleQuest.ts](../src/routes/api/multiBattleQuest.ts) |  | yes |
| `/sns/get` | POST | both | [api/stubs.ts](../src/routes/api/stubs.ts) | fixed reply (placeholder) | yes |
| `/special_exchange/buy_ticket` | POST | both | [src/nya/exchangeCampaigns.ts](../src/nya/exchangeCampaigns.ts) |  |  |
| `/special_exchange/enter_campaign` | POST | both | [src/nya/exchangeCampaigns.ts](../src/nya/exchangeCampaigns.ts) |  |  |
| `/special_exchange/exchange_character` | POST | both | [src/nya/exchangeCampaigns.ts](../src/nya/exchangeCampaigns.ts) |  |  |
| `/special_exchange/exchange_equipment` | POST | both | [src/nya/exchangeCampaigns.ts](../src/nya/exchangeCampaigns.ts) |  |  |
| `/start_dash_exchange/buy_ticket` | POST | both | [src/nya/exchangeCampaigns.ts](../src/nya/exchangeCampaigns.ts) |  |  |
| `/start_dash_exchange/exchange_character` | POST | both | [src/nya/exchangeCampaigns.ts](../src/nya/exchangeCampaigns.ts) |  |  |
| `/story_movie/view` | POST | both | [api/stubs.ts](../src/routes/api/stubs.ts) | fixed reply (placeholder) | yes |
| `/story_quest/finish` | POST | both | [api/multiBattleQuest.ts](../src/routes/api/multiBattleQuest.ts) |  | yes |
| `/story_quest/finish_with_skip` | POST | both | [api/storyQuest.ts](../src/routes/api/storyQuest.ts) |  | yes |
| `/tool/auth` | POST | CN | [api/cn.ts](../src/routes/api/cn.ts) | fixed reply (placeholder) |  |
| `/tool/change_active` | POST | CN | [api/cn.ts](../src/routes/api/cn.ts) | fixed reply (placeholder) |  |
| `/tool/check_enable_customer_service` | POST | CN | [api/cn.ts](../src/routes/api/cn.ts) | fixed reply (placeholder) |  |
| `/tool/check_enable_gift` | POST | CN | [api/cn.ts](../src/routes/api/cn.ts) | fixed reply (placeholder) | yes |
| `/tool/check_social_link_enable` | POST | CN | [api/cn.ts](../src/routes/api/cn.ts) | fixed reply (placeholder) |  |
| `/tool/contact_active` | POST | CN | [api/cn.ts](../src/routes/api/cn.ts) | fixed reply (placeholder) |  |
| `/tool/custom_notify` | POST | CN | [api/cn.ts](../src/routes/api/cn.ts) | fixed reply (placeholder) | yes |
| `/tool/get_bug_report_url` | POST | CN | [api/cn.ts](../src/routes/api/cn.ts) | fixed reply (placeholder) |  |
| `/tool/get_header_response` | POST | both | [api/tool.ts](../src/routes/api/tool.ts) |  | yes |
| `/tool/get_qq_group_url` | POST | CN | [api/cn.ts](../src/routes/api/cn.ts) | fixed reply (placeholder) |  |
| `/tool/get_survey_url` | POST | CN | [api/cn.ts](../src/routes/api/cn.ts) | fixed reply (placeholder) |  |
| `/tool/signup` | POST | both | [api/tool.ts](../src/routes/api/tool.ts) | CN-specific reply | yes |
| `/tool/unregister` | POST | both | [api/tool.ts](../src/routes/api/tool.ts) |  |  |
| `/tutorial/finish_trigger` | POST | both | [api/tutorial.ts](../src/routes/api/tutorial.ts) |  | yes |
| `/tutorial/update_step` | POST | both | [api/tutorial.ts](../src/routes/api/tutorial.ts) |  | yes |

## CN app extras (6)

Outside the API: the CN app's version check and crash/debug reports (`/cn/...`).

| Endpoint | Method | Source | Notes |
|---|---|---|---|
| `/cn/cdn/recovery/empty.csv` | GET | [cnVersion.ts](../src/routes/cnVersion.ts) |  |
| `/cn/crash` | POST | [cnVersion.ts](../src/routes/cnVersion.ts) |  |
| `/cn/debug` | POST | [cnVersion.ts](../src/routes/cnVersion.ts) |  |
| `/cn/debug` | GET | [cnVersion.ts](../src/routes/cnVersion.ts) |  |
| `/cn/shijtswy/version/client_release_android.dis` | GET | [cnVersion.ts](../src/routes/cnVersion.ts) |  |
| `/cn/shijtswy/version/client_release_ios.dis` | GET | [cnVersion.ts](../src/routes/cnVersion.ts) |  |

## Global app: Kakao services (12)

Login and platform calls the global app makes to Kakao's services, answered locally.

| Endpoint | Method | Source | Notes |
|---|---|---|---|
| `/infodesk/v2/app` | GET | [infodesk.ts](../src/routes/infodesk.ts) |  |
| `/infodesk/v2/appGroup` | GET | [infodesk.ts](../src/routes/infodesk.ts) |  |
| `/openapi/service/v3/agreement/getForLogin` | POST | [openapi.ts](../src/routes/openapi.ts) |  |
| `/openapi/service/v3/log/writeRoundLog` | POST | [openapi.ts](../src/routes/openapi.ts) |  |
| `/openapi/service/v3/log/writeSdkBasicLog` | POST | [openapi.ts](../src/routes/openapi.ts) |  |
| `/openapi/service/v3/player/heartbeat` | POST | [openapi.ts](../src/routes/openapi.ts) |  |
| `/openapi/service/v3/promotion/popup/getList` | POST | [openapi.ts](../src/routes/openapi.ts) |  |
| `/openapi/service/v3/push/token/register` | POST | [openapi.ts](../src/routes/openapi.ts) |  |
| `/openapi/service/v3/util/country/get` | POST | [openapi.ts](../src/routes/openapi.ts) |  |
| `/openapi/service/v3/zat/login` | POST | [openapi.ts](../src/routes/openapi.ts) |  |
| `/openapi/service/v4/auth/loginDevice` | POST | [openapi.ts](../src/routes/openapi.ts) |  |
| `/openapi/service/v4/device/accessToken/create` | POST | [openapi.ts](../src/routes/openapi.ts) |  |

## Game files (4)

Static downloads.

| Path | What |
|---|---|
| `/cn/cdn/*` | CN base game files (`CN_CDN_DIR`) |
| `/cn/patch/*` | StarPoint's CN updates (`<CDN_DIR>/cn_patches`) |
| `/patch/Live/2.0.0/*` | global game files and mods (`CDN_DIR`) |
| `/public/*` | the dashboard's stylesheet, fonts and images |

## Dashboard pages (9)

| Endpoint | Method | Source | Notes |
|---|---|---|---|
| `/` | GET | [web/index.ts](../src/routes/web/index.ts) |  |
| `/campaigns` | GET | [web/index.ts](../src/routes/web/index.ts) |  |
| `/events` | GET | [web/index.ts](../src/routes/web/index.ts) |  |
| `/news` | GET | [web/index.ts](../src/routes/web/index.ts) |  |
| `/news/board` | GET | [web/index.ts](../src/routes/web/index.ts) |  |
| `/player` | GET | [web/index.ts](../src/routes/web/index.ts) |  |
| `/player/:playerId` | GET | [web/player.ts](../src/routes/web/player.ts) |  |
| `/summons` | GET | [web/index.ts](../src/routes/web/index.ts) |  |
| `/unit-editor` | GET | [web/index.ts](../src/routes/web/index.ts) |  |

## Dashboard API (49)

What the dashboard pages call. These change the server's state and have no login. With
`LISTEN_HOST` at `127.0.0.1` (the default, also on the phone companion) only the same device
can reach them. Setups B and D in the README set it to `0.0.0.0`, which lets every device on your
network use the dashboard too, so do that only on a network you trust, such as your home Wi-Fi.

| Endpoint | Method | Source | Notes |
|---|---|---|---|
| `/api/player` | GET | [web_api/player.ts](../src/routes/web_api/player.ts) |  |
| `/api/player/save` | GET | [web_api/player.ts](../src/routes/web_api/player.ts) |  |
| `/api/player/save` | POST | [web_api/player.ts](../src/routes/web_api/player.ts) |  |
| `/api/server/account/active` | GET | [web_api/server.ts](../src/routes/web_api/server.ts) |  |
| `/api/server/account/active` | POST | [web_api/server.ts](../src/routes/web_api/server.ts) |  |
| `/api/server/account/claim` | POST | [web_api/server.ts](../src/routes/web_api/server.ts) |  |
| `/api/server/account/claim` | GET | [web_api/server.ts](../src/routes/web_api/server.ts) |  |
| `/api/server/account/claim/cancel` | POST | [web_api/server.ts](../src/routes/web_api/server.ts) |  |
| `/api/server/activeMission` | GET | [web_api/server.ts](../src/routes/web_api/server.ts) |  |
| `/api/server/campaigns` | GET | [web_api/server.ts](../src/routes/web_api/server.ts) |  |
| `/api/server/campaigns` | POST | [web_api/server.ts](../src/routes/web_api/server.ts) |  |
| `/api/server/clock` | GET | [web_api/server.ts](../src/routes/web_api/server.ts) |  |
| `/api/server/drops` | GET | [web_api/server.ts](../src/routes/web_api/server.ts) |  |
| `/api/server/drops` | POST | [web_api/server.ts](../src/routes/web_api/server.ts) |  |
| `/api/server/event-image/:file` | GET | [web_api/server.ts](../src/routes/web_api/server.ts) |  |
| `/api/server/events` | GET | [web_api/server.ts](../src/routes/web_api/server.ts) |  |
| `/api/server/events/schedule` | POST | [web_api/server.ts](../src/routes/web_api/server.ts) |  |
| `/api/server/events/schedule-many` | POST | [web_api/server.ts](../src/routes/web_api/server.ts) |  |
| `/api/server/events/unschedule` | POST | [web_api/server.ts](../src/routes/web_api/server.ts) |  |
| `/api/server/events/unschedule-many` | POST | [web_api/server.ts](../src/routes/web_api/server.ts) |  |
| `/api/server/gacha-rates` | GET | [web_api/server.ts](../src/routes/web_api/server.ts) |  |
| `/api/server/gacha-rates` | POST | [web_api/server.ts](../src/routes/web_api/server.ts) |  |
| `/api/server/give` | GET | [web_api/server.ts](../src/routes/web_api/server.ts) |  |
| `/api/server/loginBonus/again` | POST | [web_api/server.ts](../src/routes/web_api/server.ts) |  |
| `/api/server/news` | GET | [web_api/server.ts](../src/routes/web_api/server.ts) |  |
| `/api/server/news` | POST | [web_api/server.ts](../src/routes/web_api/server.ts) |  |
| `/api/server/news/delete` | POST | [web_api/server.ts](../src/routes/web_api/server.ts) |  |
| `/api/server/phone-connection` | GET | [web_api/server.ts](../src/routes/web_api/server.ts) |  |
| `/api/server/phone-connection/server.txt` | GET | [web_api/server.ts](../src/routes/web_api/server.ts) |  |
| `/api/server/removeCharacter` | GET | [web_api/server.ts](../src/routes/web_api/server.ts) |  |
| `/api/server/resetTime` | GET | [web_api/server.ts](../src/routes/web_api/server.ts) |  |
| `/api/server/rotation` | GET | [web_api/server.ts](../src/routes/web_api/server.ts) |  |
| `/api/server/rotation/goto` | GET | [web_api/server.ts](../src/routes/web_api/server.ts) |  |
| `/api/server/rotation/next` | GET | [web_api/server.ts](../src/routes/web_api/server.ts) |  |
| `/api/server/rotation/previous` | GET | [web_api/server.ts](../src/routes/web_api/server.ts) |  |
| `/api/server/rotation/resume` | GET | [web_api/server.ts](../src/routes/web_api/server.ts) |  |
| `/api/server/settings` | GET | [web_api/server.ts](../src/routes/web_api/server.ts) |  |
| `/api/server/settings` | POST | [web_api/server.ts](../src/routes/web_api/server.ts) |  |
| `/api/server/time` | GET | [web_api/server.ts](../src/routes/web_api/server.ts) |  |
| `/api/server/time/match-real` | POST | [web_api/server.ts](../src/routes/web_api/server.ts) |  |
| `/api/unit-editor/check` | POST | [web_api/unitEditor.ts](../src/routes/web_api/unitEditor.ts) |  |
| `/api/unit-editor/data` | GET | [web_api/unitEditor.ts](../src/routes/web_api/unitEditor.ts) |  |
| `/api/unit-editor/kits` | GET | [web_api/unitEditor.ts](../src/routes/web_api/unitEditor.ts) |  |
| `/api/unit-editor/kits` | POST | [web_api/unitEditor.ts](../src/routes/web_api/unitEditor.ts) |  |
| `/api/unit-editor/lines/:id` | GET | [web_api/unitEditor.ts](../src/routes/web_api/unitEditor.ts) |  |
| `/api/unit-editor/unit/:id` | GET | [web_api/unitEditor.ts](../src/routes/web_api/unitEditor.ts) |  |
| `/api/unit-editor/unit/:id` | POST | [web_api/unitEditor.ts](../src/routes/web_api/unitEditor.ts) |  |
| `/api/unit-editor/unit/:id/reset` | POST | [web_api/unitEditor.ts](../src/routes/web_api/unitEditor.ts) |  |
| `/api/unit-editor/units` | GET | [web_api/unitEditor.ts](../src/routes/web_api/unitEditor.ts) |  |

## Other (3)

| Endpoint | Method | Source | Notes |
|---|---|---|---|
| `/companion/file` | GET | [companion.ts](../src/routes/companion.ts) |  |
| `/companion/manifest` | GET | [companion.ts](../src/routes/companion.ts) |  |
| `/starpoint/battle_log` | POST | [battleLog.ts](../src/routes/battleLog.ts) |  |
