# Global app (legacy)

These pages are from the original [StarPoint](https://github.com/duosii/starpoint), for the **global**
(English, Kakao) World Flipper app. GlobalPoint is built around the CN app, and the global app is
legacy: it still connects, but nothing more is added to it or fixed on it. See the main
[README](../../README.md) for the CN app.

| Page | What it is | Still accurate? |
|---|---|---|
| [connecting-android.md](connecting-android.md) | connecting the global app on an unrooted Android device (mitmproxy + WireGuard) | as written in 2024; untested since |
| [connecting-android-root.md](connecting-android-root.md) | the same for rooted devices and emulators | as written in 2024; untested since |
| [connecting-ios.md](connecting-ios.md) | the same for iOS | as written in 2024; untested since |
| [modding.md](modding.md) | installing mods from `.cdn/mods` | global app only (the CN app gets its changes as game updates instead) |
| [routes.md](routes.md) | the global game's API endpoints, with StarPoint's implementation status | **status is a 2024 snapshot** and outdated |
| [routes/](routes/) | one page per endpoint | see below |

## About `routes/`

Every page in `routes/` is **captured traffic between the official global game and Kakao's servers**,
recorded before the shutdown: the request headers and body the app sent, and the reply it got back.
They cover three hosts:

- `na.wdfp.kakaogames.com`: the game API (67 pages)
- `gc-openapi-zinny3.kakaogames.com`: Kakao's login and platform API (14 pages)
- `gc-infodesk-zinny3.kakaogames.com`: Kakao's info desk (2 pages)

They're reference material for how the real servers answered. They don't describe GlobalPoint's own
routes, and they contain nothing from the CN app, which talks to a different (Leiting) API.

The status column in `routes.md` was StarPoint's progress in 2024. Many endpoints marked partial or
not started have been implemented since, for both apps. The up-to-date list is
[docs/routes.md](../routes.md), generated from the server itself.
