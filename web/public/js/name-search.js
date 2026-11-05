// Search by name for the dashboard's ID boxes (Players > Give, the Mail tab): type part of a unit's, armament's or
// item's name, pick a match, and its ID goes into the ID box. Typing an ID still works; the name it stands for
// shows underneath. Names come from /api/unit-editor/names (the game's own tables, English where translated).
//
//   attachNameSearch(kindSelect, idInput, container)
//   kindSelect's value: "chara" | "equip" | "item" (anything else hides the search)
(function () {
    let names = null
    const load = () => names ??= fetch("/api/unit-editor/names").then(r => r.ok ? r.json() : Promise.reject(new Error(r.statusText)))
    let lists = 0

    window.attachNameSearch = function (kindSelect, idInput, container) {
        const listId = "name-search-" + (++lists)
        const box = document.createElement("div")
        box.className = "flex flex-col gap-1 w-full"
        const search = document.createElement("input")
        search.type = "text"
        search.setAttribute("list", listId)
        search.placeholder = "Search by name…"
        search.autocomplete = "off"
        search.className = "my-input rounded-2xl border border-outline-variant bg-surface-container-low text-on-surface px-4 py-2"
        search.style.width = "100%"
        const options = document.createElement("datalist")
        options.id = listId
        const shown = document.createElement("span")
        shown.className = "text-sm text-on-surface-variant"
        box.append(search, options, shown)
        container.appendChild(box)

        const kind = () => kindSelect.value
        const label = (x) => x.name + (x.note ? " — " + x.note : "") + " (#" + x.id + ")"

        let data = null
        function fill() {
            options.replaceChildren()
            const list = data?.[kind()] ?? []
            for (const x of list) {
                const o = document.createElement("option")
                o.value = label(x)
                options.appendChild(o)
            }
        }
        function showName() {
            const list = data?.[kind()]
            if (!list) { shown.textContent = ""; return }
            const id = String(idInput.value || "").trim()
            if (!id) { shown.textContent = ""; return }
            const hit = list.find(x => x.id === id)
            shown.textContent = hit ? "→ " + label(hit) : "→ no " + ({ chara: "unit", equip: "armament", item: "item" })[kind()] + " with ID " + id
        }
        function sync() {
            const on = ["chara", "equip", "item"].includes(kind())
            box.style.display = on ? "" : "none"
            search.value = ""
            fill()
            showName()
        }
        search.addEventListener("input", () => {
            const m = /\(#(\d+)\)$/.exec(search.value)
            if (!m) return
            idInput.value = m[1]
            idInput.dispatchEvent(new Event("input", { bubbles: true }))
            idInput.dispatchEvent(new Event("change", { bubbles: true }))
            search.value = ""
            showName()
        })
        idInput.addEventListener("input", showName)
        idInput.addEventListener("change", showName)
        kindSelect.addEventListener("change", sync)
        sync()
        load().then(d => { data = d; fill(); showName() })
            .catch(e => { shown.textContent = "Names couldn't load (" + e.message + "): type the ID." })
        return { refresh: showName }
    }
})()
