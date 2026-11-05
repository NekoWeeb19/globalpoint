# Dashboard guide

How to do the common jobs on the GlobalPoint dashboard, after a quick list of what each tab holds.

**Opening it:** with the server running, go to **http://127.0.0.1:8000** in a browser on the same
PC. On a phone with the companion app, tap **Dashboard** in the companion: that's the phone's own
server, not the PC's.

**Times are UTC** everywhere on the dashboard, not your local time.

**Changes reach the game at its title screen.** After a change to events, summons, campaigns or
the date, close the game fully and open it again. It downloads a small update before the title
screen. The server builds that update in the background, so give it a minute or two on a PC (a few
minutes on a phone) before reopening.

## The tabs

- **Dashboard (first tab)**
  - **Server time:** Visit past and future content. New installs start on 2019-12-01, just before
    the CN game's first regular banners and events. Changing it also changes which units have Mana Board 2,
    awakening and EX Boost, and which kit they use (see [Balance by date](DETAILS.md#balance-by-date)); the
    game gets a small update the next time it reaches the title screen.
  - **Quest drop amount:** multiplies quest drops (items, materials, mana, EXP) and event drops, from
    1x up to 100x. The default, 1x, is the base game's own amounts.
    Original StarPoint always gave 10x; set 10 to match it, or go higher for less grind.
  - **Enemy strength:** multiplies every enemy's HP and attack (0.1x to 10x each) for a harder or easier
    game; the game gets a small update the next time it reaches the title screen.
  - **Play on a phone over Wi-Fi:** downloads the `server.txt` connection file for setup D (shown
    when the server listens on the network).
  - **Daily paid beads and free mails:** the paid beads added to each daily login bonus (150 by
    default, 0 turns it off), and the three never-ending mails (Bread, Mana and EXP x1500) that can
    be claimed again and again. Turn any of them off to remove it.
  - **Summon rates:** the 5★ and 4★ chance per pull for unit banners, Star Fest / Meteor Festival and armament portals
    (base game: 5% / 25% unit banners and armaments, 7.5% / 25% Star Fest and Meteor Festival).
  - **Banner rotation**: the original StarPoint feature for the global app (legacy, PC only). Hidden unless
    `BANNER_ROTATION="true"` or `DASHBOARD_BANNER_ROTATION="true"` is in `.env`.
- **Events, Summons and Campaigns** list everything by start date, with the CN game's own dates.
- **Events:** every event, CN-only ones included. Move any of them to any date. Each change builds a
  small game update that the game downloads the next time it reaches the title screen.
- **Summons:** schedule summon banners, with their banner art.
- **Campaigns:** yearly login bonuses, free pulls and stamina/reward campaigns.
- **News:** posts shown on the game's in-game News board.
- **Mail:** gifts that arrive in the in-game mailbox at a set server time, once or repeating
  (every N days, weeks, months or years), claimable for 30 days.
- **Players:** accounts, saves (download and upload), gifts, and removing a unit from a save.
- **Unit editor:** change any unit's abilities, numbers and details
  ([UNIT_EDITOR.md](UNIT_EDITOR.md)).

---

## Jobs

### Go to another date, and back

![The dashboard's first tab: server time, quest drop amount, daily paid beads](images/dashboard-home.png)

First tab (**Dashboard**):
1. In the box at the top ("Change the server's time to visit past and future content"), pick a
   date and time and press **Set Time**. The clock keeps ticking from there.
2. To come back, press **Reset**: the server uses today's real time again. (With banner rotation
   on, Reset hands the date back to the rotation instead.)

**Match real time (keep date)** keeps the server's date but sets its time of day to the PC's
clock, so the server's day turns over with the daily reset.

New installs start on 2019-12-01, just before the CN game's first banners and events.

### Move an event

![The Events tab, filtered to the CN app](images/dashboard-events.png)

**Events** tab:
1. Find the event (search, or filter by **Game**, **Kind** and **Show**: On now, Coming up, Moved
   by you). Set **Game** to **CN app** to see the CN game's list.
2. Press **Schedule** next to it, set **Starts** and **Ends** (or press **Start now**, and
   **Original length** to keep its length), and **Save**. Its quests, missions, shop, tokens and
   help pages move with it.

   ![An event's date editor](images/dashboard-event-editor.png)
3. To move several at once, tick them and use **All start at (UTC)**: each keeps its own length.
   **Also move the summon banners that opened with them** moves their banners too.
4. **Back to original dates** undoes a move.

Then reopen the game.

### Schedule a summon banner

**Summons** tab: the same page and controls as Events, for unit and armament banners. Find the
banner, press **Schedule**, set the dates, **Save**, and reopen the game. A banner given dates here
keeps them, even if an event it opened with is moved later.

### Repeat a yearly campaign

**Campaigns** tab: seasonal login bonuses, seasonal free pulls, stamina campaigns and reward
campaigns.
1. Tick a campaign to make it **repeat every year** on the same dates (the CN game's own dates
   where known). Untick it to stop the repeats.
2. Press **Save** (or **Undo changes**), then reopen the game.

Where two picked campaigns would run at the same time, the longer one runs that year. A free pull
works on any regular unit banner open at the time, and skips a year where one of the game's own
free pull campaigns runs then.

### Give a unit, an item, an armament or beads

![A player's page: save download and upload, Give](images/dashboard-player.png)

**Players** tab > pick a player > **Give**: choose **Character**, **Item** or **Equipment**
(armament), type its ID number and the amount, and press **Send Mail (in session)**. It arrives in the player's in-game
mailbox. No need to know the ID: type part of a name in **Search by name** (units, armaments and items, in English
where translated), pick it, and the ID is filled in. Typing an ID shows the name it stands for. The Mail tab has the
same search.

Beads aren't an item, so they have no ID: choose **Paid beads** or **Free beads**, type the amount (the ID box goes
away) and send. **Title** and **Message** are optional: left empty, the mail says "Give Item" (or what it is) and
"From Web API". Like every Give mail, it waits only while the server keeps running: claim it before you restart the
server. For mail that's saved and can arrive later or again and again, use the **Mail** tab (next section).

### Schedule mail (once, or again and again)

**Mail** tab: gifts that arrive in the in-game mailbox at a set time, like the game's own maintenance and event gifts.
1. **Send**: paid beads, free beads, mana, EXP, or an item, unit or armament (those need their **ID**), and the
   **Amount**. **Title** and **Message** are optional (else e.g. "Paid beads * 300" and "A gift from the server.").
2. **First send**: a date and time in server time (UTC). **Now** fills in the server's current time.
3. **Repeat**: **Once**, or **Every** N days, weeks, months or years, at the same time of day, either a number of
   **Times in all** or **Forever**. Monthly and yearly keep the day of the month (the 31st falls on the 30th or 28th in
   shorter months).
4. **Schedule**. The list shows the next send, how many were delivered, and how many wait to be claimed. **Edit**
   changes one; **Delete** stops it (mails already in the mailbox stay).

How it behaves:
- It follows the **server time**, so moving the server's date on the Dashboard tab makes due mails arrive.
- **A first send time that has already passed** sends one mail right away, then it keeps its own times: "every Monday
  from the 1st", scheduled on a Wednesday, sends now and then on Mondays. The missed sends in between aren't all sent.
  Changing only a mail's title or message doesn't send it again; changing its times starts it over the same way.
- **A save made later** (a new account) still gets the sends from before it existed, dated as sent, as long as they're
  under 30 days old.
- Each mail can be claimed for **30 days** after it arrives, then it's gone. After a long jump forward in server time,
  only the sends from the last 30 days arrive (the older ones would have expired).
- Only the **active save** gets it: the CN account picked on the Players tab (or `CN_ACCOUNT_ID`). With none picked,
  any save that opens its mailbox does.
- It's saved (`.database/mail_schedule.json` and `mail_delivered.json`), so mails survive restarts, and the companion's
  **Download from PC** brings them along with **My save**.
- The game refuses a mail it has no room for ("cannot be opened due to storage limits"), e.g. beads on a save that
  already has a huge number of them.

For daily beads and other basics, see [Paid beads, free mails and drops](#paid-beads-free-mails-and-drops)
below.

The player page also has:
- **Unlock** / **Reset** a mission's reward (restart the game, then claim it on the missions screen);
- **Give login bonus again**;
- **Remove a unit**: takes a unit out of this save (with its Mana Boards, party places and records), e.g.
  before a custom unit is deleted ([CUSTOM_UNITS.md](CUSTOM_UNITS.md#removing-a-unit-safely)). Close the game
  first; it can't be undone, so download the save first if you want a copy;
- **Link my reinstalled game to this player**: press it before you open a reinstalled game, and its
  next new guest login (within 30 minutes) loads this player instead of a new one.

### Back up or move a save

- **Players** > a player > **Download Save** gives that player's save as a JSON file.
  **Upload Save** puts one back, replacing that player's data. This works between any two
  servers: download on one dashboard, upload on the other.
- **Players** > **Active account** picks which player each app plays on. Reopen the game to switch.
- **On a phone** (companion app): **Export save** writes the whole save database to a zip, and
  **Import save** puts one back. To bring a PC save to the phone, use **Game data** > **My save**
  in the companion's **Download from PC**.

### Post news

![The News tab](images/dashboard-news.png)

**News** tab: under **New post**, write a title and the text (plain text; a blank line between
paragraphs), pick the **Category** (the CN app's News tab it shows under) and the app it shows in
(**Show in**), and press **Post**. Players see it the next time they open News in the game.

### Paid beads, free mails and drops

First tab (**Dashboard**):
- **Quest drop amount:** 1x (the default) is the base game's own amounts. Original StarPoint gave
  10x. Pick a preset or type any value from 1x to 100x, then **Save**. It applies from the next
  quest you finish.
- **Paid beads with each daily login bonus:** added once a day on top of the login bonus's own
  rewards (150 by default; 0 turns it off).
- **Never-ending mails:** Bread x1500, Mana x1500 and EXP x1500 sit in the mailbox and can be
  claimed again and again. Untick one to remove it.

### Make enemies stronger or weaker

First tab (**Dashboard**) > **Enemy strength**: multiplies every enemy's HP and attack in every
quest, main story included (regular enemies, bosses and what bosses summon; breakable blocks stay
as they are).
1. Type an **HP** and an **attack** multiplier, from 0.1x to 10x each, or pick a preset (**1x (base
   game)**, **HP 1.5x, attack 1.2x**, **2x both**, **0.5x both**), and press **Save**. Above 1x is
   harder, below 1x easier.
2. Close and reopen the game: saving rebuilds the game update. (A phone, or a Wi-Fi copy, rebuilds
   at the companion server's next start.)

On the emulator, at 10x HP and attack a weak auto-play party was down in 40 seconds with the boss
untouched; at 0.1x HP the same fight took 1:58 instead of 4:32. Boss fights have scripted phases, so the
time doesn't shrink by the full factor.

### Change summon rates

![The Summon rates box on the first tab](images/dashboard-rates.png)

First tab (**Dashboard**) > **Summon rates**: the chance of a 5★ and a 4★ per pull, for three kinds
of portal: **Unit banners** (the standard portal and every pickup/spotlight banner), **Star Fest / Meteor Festival**
and **Armaments**. 3★ is the rest.
1. Type the percentages (0 to 100, one decimal) and press **Save**. The badge then says **Custom**.
2. **Base game rates** puts them back, as the game's own Rates screens show them: unit banners 5% 5★ / 25% 4★, Star Fest
   and Meteor Festival 7.5% / 25% (their "★5 ×1.5"), armaments 5% / 25%.

It applies from the next pull, and no game update is needed. Featured units keep their boost within
their rarity. The 10th pull of a 10-pull is still 4★ or better (5★ at the 5★ rate), and special
pulls with their own rules (like a once-per-account guaranteed 5★) keep them. The game's own Rates
screen keeps showing the original numbers. The companion's **Download from PC** brings the PC's
rates along when **My save** is ticked.

### Edit a unit's or an armament's abilities and numbers

**Unit editor** in the menu (`/unit-editor`): works for every CN unit, every CN armament and custom
units. No ids change, so saves are never at risk. The full guide is [UNIT_EDITOR.md](UNIT_EDITOR.md).

![The Unit editor with Amelia open on the Abilities tab](images/dashboard-unit-editor.png)

1. Pick a unit.
2. Change it on one of three tabs:
   - **Abilities**: each ability (1-6) and the leader skill, one line per effect (**Only if**
     conditions, the trigger, and what it **Does**). Add, remove or copy lines from another unit;
     **Reset to game** gives an ability its own lines back. **In game** under each ability shows it
     in the unit page's own words. For lines the game's wording can't show yet, tick **Use the
     editor's wording where the game's can't be shown** to see the editor's own sentence instead.

     ![One ability: its line, its fields, and the In game wording](images/dashboard-unit-ability.png)
   - **Numbers**: HP/ATK, the skill gauge, and every min → max value.
   - **Details**: name, title, description, leader skill name, class (it also picks the Power Flip)
     and role.
3. Press **Save**. It stays greyed out while a line breaks a rule (a contradiction, a target the
   trigger can't have, or something the game can't read). The server rebuilds the game update.
4. Close and reopen the game.

- **Mode** (at the top; the browser remembers it):
  - **Default** offers only the triggers and conditions CN's own units use, in the pairs they use.
  - **Advanced** allows CN's own parts in any combination, with a note on pairs no CN unit uses.
  - **Unrestricted** also offers parts CN never uses, marked "untested", with a warning: they may
    not work or may crash the game.
- **Armaments:** switch **Units / Armaments** at the top to edit any of CN's armaments the same way.
  Each effect can have up to 3 versions by armament level (e.g. +50% from level 3, +100% from
  level 5); the Numbers tab has HP/ATK by level, and Details its name and description.
- **Edited units and kits** at the top lists every edited unit: **Download** them as a kit file, or
  **Import a kit file** from someone else.
- **Reset unit to game** removes the editor's changes for that unit.
- **On a phone**, the editor is in the companion's **Dashboard** too, and the phone rebuilds its own
  game update. With a PC, **Download from PC** brings the PC's edits and replaces the phone's own,
  so edit on one side only (or download a kit on the phone and import it on the PC first).

New units are added with files, not on the dashboard: see [CUSTOM_UNITS.md](CUSTOM_UNITS.md).

---

## Gotchas

- **The date changes how units play.** Moving the server's date also changes which units have Mana
  Board 2, awakening and EX Boost, and which kit (abilities and numbers) they use: units play as
  they did on that date. A unit your save already moved to Mana Board 2 keeps it. See
  [Balance by date](DETAILS.md#balance-by-date).
- **Nothing shows until the title screen.** The game only picks up schedule and date changes when
  it reaches the title screen. If you open it before the server has finished building the update,
  you may get an error (like C8601) or the old dates: close it, wait a minute, open it again.
- **Yearly copies follow the clock.** Repeating campaigns, and The Haunt's monthly floors, are built
  for the game clock's year, one year before it and one after. Move the date further and the server
  rebuilds them by itself, so expect a small download at the next title screen.
- **The Haunt** opens on 2020-01-12 and stays open. It has a new set of floors every month (fresh,
  uncleared), also in the months before and after CN's own 48 months of it (2022-05 to 2026-04).
- **On a phone, it's the phone's dashboard.** The companion's **Dashboard** button opens the
  phone's own server. Changes there don't touch your PC, and the other way round.
- **There's no login.** Anyone who can reach the server can use the dashboard. With
  `LISTEN_HOST` at `127.0.0.1` (the default) that's only the same device. Setting it to `0.0.0.0`
  (setups B and D) opens it to your whole network, so do that only on a network you trust.
