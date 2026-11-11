// The dashboard's sidebar on every page, loaded with <script src="/public/js/sidebar-status.js" defer>:
// - a status block at the bottom of the sidebar: the server's time, the real time, when the next daily reset
//   is, and whether the game update is ready or being rebuilt (after a change on the dashboard the server
//   rebuilds it in the background; a game opened meanwhile gets the old one or an error);
// - wide screens: the sidebar stays in view while the page scrolls;
// - phones: the sidebar becomes a drawer that slides in from the left, opened from a slim top bar that always
//   shows the page's name, the server time and a status dot.
(function () {
    const DAY = 86400000
    const RESET_HOUR = 5 // UTC, by the real clock (login bonus, daily missions)
    const nav = document.querySelector("body nav")
    if (!nav) return

    // wide screens: sticky sidebar, the status block pinned to its bottom (if the window is too short for every
    // link, the links scroll inside the sidebar and the status stays)
    nav.classList.add("md:sticky", "md:top-3", "md:max-h-[calc(100vh-1.5rem)]", "md:overflow-y-auto")
    // phones: the sidebar is a drawer, off screen until the menu button opens it
    nav.classList.add("max-md:fixed", "max-md:inset-y-0", "max-md:left-0", "max-md:z-50", "max-md:w-[85vw]", "max-md:max-w-sm",
        "max-md:h-auto", "max-md:rounded-none", "max-md:rounded-r-3xl", "max-md:overflow-y-auto", "max-md:-translate-x-full",
        "transition-transform", "duration-200")
    nav.id ||= "sidebar"

    const block = document.createElement("div")
    block.className = "mt-3 pt-4 pb-1 px-2 border-t border-outline-variant flex flex-col gap-2 text-sm md:sticky md:bottom-0 bg-surface-container-low"
    block.setAttribute("aria-label", "Server status")
    block.innerHTML = `
        <div class="flex flex-col">
            <span class="text-on-surface-variant">Server time (UTC)</span>
            <span data-status="server" class="text-base font-semibold text-on-background">...</span>
        </div>
        <div class="flex flex-col">
            <span class="text-on-surface-variant">Real time (UTC)</span>
            <span data-status="real" class="text-on-surface">...</span>
        </div>
        <span data-status="reset" class="text-on-surface-variant"></span>
        <span data-status="update" role="status" class="px-3 py-2 rounded-2xl bg-surface-container-high text-on-surface">Checking the game update...</span>`
    nav.appendChild(block)
    const part = (name) => block.querySelector(`[data-status="${name}"]`)

    // ---- phones: top bar, drawer and the dimmed page behind it ----
    const active = nav.querySelector(".bg-primary")
    const title = active ? active.textContent.trim() : document.title.replace(/^Starpoint:?\s*/, "") || "Dashboard"
    const bar = document.createElement("div")
    bar.className = "md:hidden fixed top-0 inset-x-0 z-30 flex items-center gap-3 px-3 py-2 bg-surface-container-low border-b border-outline-variant"
    bar.innerHTML = `
        <button type="button" data-drawer="open" aria-label="Open the menu" aria-controls="${nav.id}" aria-expanded="false"
            class="w-10 h-10 rounded-full flex items-center justify-center hover:bg-surface-container-high">
            <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" class="fill-on-surface">
                <path d="M120-240v-80h720v80H120Zm0-200v-80h720v80H120Zm0-200v-80h720v80H120Z" />
            </svg>
        </button>
        <span class="font-semibold text-on-background truncate">${title.replace(/[<>&]/g, "")}</span>
        <span class="ml-auto flex items-center gap-2 text-sm text-on-surface-variant whitespace-nowrap">
            <span data-bar="dot" class="w-3 h-3 rounded-full bg-surface-container-high" aria-hidden="true"></span>
            <span data-bar="time">...</span>
        </span>`
    document.body.appendChild(bar)
    const shade = document.createElement("div")
    shade.className = "hidden md:hidden fixed inset-0 z-40 bg-black/50"
    document.body.appendChild(shade)
    const menuButton = bar.querySelector('[data-drawer="open"]')

    function setDrawer(open) {
        nav.classList.toggle("max-md:-translate-x-full", !open)
        nav.classList.toggle("max-md:translate-x-0", open)
        shade.classList.toggle("hidden", !open)
        menuButton.setAttribute("aria-expanded", String(open))
        document.body.classList.toggle("max-md:overflow-hidden", open)
        if (open) nav.querySelector("a, div")?.focus?.()
    }
    menuButton.addEventListener("click", () => setDrawer(true))
    shade.addEventListener("click", () => setDrawer(false))
    document.addEventListener("keydown", (event) => { if (event.key === "Escape") setDrawer(false) })
    nav.addEventListener("click", (event) => { if (event.target.closest("a")) setDrawer(false) })

    // ---- clocks and the game update ----
    let clock = null
    const utc = (ms) => new Date(ms).toISOString().slice(0, 16).replace("T", " ")
    const serverNow = () => clock === null ? NaN : Date.parse(clock.serverDate) + (clock.ticking ? Date.now() - clock.loadedAt : 0)

    function span(ms) {
        const minutes = Math.max(0, Math.round(ms / 60000))
        const h = Math.floor(minutes / 60), m = minutes % 60
        return h > 0 ? h + " h " + m + " min" : m + " min"
    }
    function nextReset() {
        const now = new Date()
        const reset = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), RESET_HOUR)
        return reset > now.getTime() ? reset : reset + DAY
    }

    function showClock() {
        const now = serverNow()
        if (!isNaN(now)) {
            part("server").textContent = utc(now)
            bar.querySelector('[data-bar="time"]').textContent = utc(now) + " UTC"
        }
        part("real").textContent = utc(Date.now())
        part("reset").textContent = "Daily reset in " + span(nextReset() - Date.now())
    }

    const STYLES = {
        ready: ["bg-tertiary-container text-on-tertiary-container", "bg-tertiary"],
        rebuilding: ["bg-primary-container text-on-primary-container", "bg-primary"],
        down: ["bg-error-container text-on-error-container", "bg-error"],
    }
    function showUpdate(state, text) {
        const badge = part("update")
        badge.className = "px-3 py-2 rounded-2xl " + STYLES[state][0]
        badge.textContent = text
        const dot = bar.querySelector('[data-bar="dot"]')
        dot.className = "w-3 h-3 rounded-full " + STYLES[state][1]
        dot.parentElement.title = text
    }

    async function loadClock() {
        try {
            const response = await fetch("/api/server/clock")
            if (!response.ok) throw new Error(response.statusText)
            clock = await response.json()
            clock.loadedAt = Date.now()
            showClock()
        } catch { /* the update check below says the server can't be reached */ }
    }

    async function loadStatus() {
        try {
            const response = await fetch("/api/server/status")
            if (!response.ok) throw new Error(response.statusText)
            const status = await response.json()
            if (status.updateRebuilding) showUpdate("rebuilding", "Rebuilding the game update: wait before opening the game")
            else showUpdate("ready", "Game update ready")
        } catch {
            showUpdate("down", "Can't reach the server")
        }
    }

    loadClock()
    loadStatus()
    setInterval(showClock, 1000)
    setInterval(loadStatus, 5000)
    setInterval(loadClock, 30000)
    // a change on this page (a moved event, a new date) starts a rebuild: look again soon after any click
    document.addEventListener("click", () => setTimeout(() => { loadStatus(); loadClock() }, 1500), true)
})()
