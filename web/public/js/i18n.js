// The dashboard's own language (English or 简体中文), loaded first on every page (in <head>, not deferred):
// - the choice is kept per browser (localStorage "dashboardLanguage"); with none, the browser's language decides;
// - in Chinese the dictionary (/public/i18n/zh.json, built with scripts/dashboard_strings.cjs) is read before the page
//   shows, and every text the page has or adds later is swapped: whole elements whose sentence has inline formatting
//   ("html:" keys: the element's inner HTML), text pieces, the attributes people read, and "patterns" (regular
//   expressions) for messages with numbers or names in them.
// The game's own language is a separate setting (Game settings > Game language).
// Pages call window.t("English") for text they build themselves when a fragment won't do.
(function () {
    const KEY = "dashboardLanguage"
    let lang = null
    try { lang = localStorage.getItem(KEY) } catch { }
    if (lang !== "zh" && lang !== "en") lang = /^zh/i.test(navigator.language || "") ? "zh" : "en"
    window.dashboardLanguage = lang
    window.setDashboardLanguage = next => {
        try { localStorage.setItem(KEY, next) } catch { }
        location.reload()
    }
    window.t = text => text
    if (lang !== "zh") return
    document.documentElement.lang = "zh-Hans"

    // synchronous on purpose: the page mustn't show its English first
    let dict = { strings: {}, patterns: [] }
    try {
        const request = new XMLHttpRequest()
        request.open("GET", "/public/i18n/zh.json", false)
        request.send()
        if (request.status === 200) dict = JSON.parse(request.responseText)
    } catch { }
    const strings = dict.strings || {}
    const patterns = (dict.patterns || []).map(([re, to]) => [new RegExp("^" + re + "$"), to])
    const norm = s => s.replace(/[\s ]+/g, " ").trim()
    const lookup = text => {
        const key = norm(text)
        if (!key || !/[A-Za-z]/.test(key)) return null
        if (strings[key] !== undefined) return strings[key]
        for (const [re, to] of patterns) if (re.test(key)) return key.replace(re, (...m) => to.replace(/\$(\d)/g, (_, n) => lookup(m[n]) ?? m[n]))
        return null
    }
    window.t = text => lookup(text) ?? text
    // the browser's own dialogs (confirm, alert, prompt) show text the observer never sees
    const nativeConfirm = window.confirm.bind(window), nativeAlert = window.alert.bind(window), nativePrompt = window.prompt.bind(window)
    window.confirm = message => nativeConfirm(window.t(String(message ?? "")))
    window.alert = message => nativeAlert(window.t(String(message ?? "")))
    window.prompt = (message, value) => nativePrompt(window.t(String(message ?? "")), value)

    const WHOLE = "p,li,label,h1,h2,h3,h4,h5,h6,small,dd,dt,td,th,summary,legend"
    const INLINE = /<(b|i|em|strong|code|a|br|span|kbd|u|sup|sub)\b/i
    const wholeKey = html => norm(html.replace(/&nbsp;/g, " ").replace(/\s+(class|style|id|data-[a-z-]+|aria-[a-z-]+)="[^"]*"/g, ""))
    const ATTRS = ["placeholder", "title", "aria-label", "alt"]

    function translateElement(el) {
        if (el.dataset && el.dataset.i18nDone === "1") return true
        if (el.matches && el.matches(WHOLE) && INLINE.test(el.innerHTML) && !el.querySelector("input,select,textarea,button,svg")) {
            const zh = strings["html:" + wholeKey(el.innerHTML)]
            if (zh !== undefined) {
                // the inner elements keep their attributes (ids the page's code fills in, classes, styles): the
                // translation's elements are matched to the original ones by their order
                const before = [...el.querySelectorAll("*")]
                el.innerHTML = zh
                const after = [...el.querySelectorAll("*")]
                after.forEach((node, i) => {
                    const old = before[i]
                    if (!old || old.tagName !== node.tagName) return
                    for (const a of [...old.attributes]) if (!node.hasAttribute(a.name)) node.setAttribute(a.name, a.value)
                    // an element the code fills in (empty in the dictionary) keeps what it had
                    if (!node.childNodes.length && old.childNodes.length) node.append(...old.childNodes)
                })
                el.dataset.i18nDone = "1"
                return true
            }
        }
        // a value is only written when it changes: writing the same text again would wake the observer forever
        // (some translations keep English letters: "HP", "English", "Skill+")
        for (const a of ATTRS) {
            const v = el.getAttribute && el.getAttribute(a)
            if (v) { const zh = lookup(v); if (zh !== null && zh !== v) el.setAttribute(a, zh) }
        }
        if (el.tagName === "INPUT" && /^(button|submit|reset)$/i.test(el.type) && el.value) { const zh = lookup(el.value); if (zh !== null && zh !== el.value) el.value = zh }
        return false
    }
    function translateText(node) {
        const parent = node.parentElement
        if (!parent || /^(SCRIPT|STYLE|TEXTAREA|CODE)$/.test(parent.tagName) || parent.closest("[data-no-i18n]")) return
        const zh = lookup(node.nodeValue)
        if (zh === null) return
        const lead = node.nodeValue.match(/^\s*/)[0], trail = node.nodeValue.match(/\s*$/)[0]
        const next = lead + zh + trail
        if (next !== node.nodeValue) node.nodeValue = next
    }
    function walk(root) {
        if (root.nodeType === 3) return translateText(root)
        if (root.nodeType !== 1 || root.closest && root.closest("[data-no-i18n]")) return
        if (translateElement(root)) return
        for (const child of [...root.childNodes]) walk(child)
    }
    const observer = new MutationObserver(records => {
        for (const r of records) {
            if (r.type === "characterData") translateText(r.target)
            else if (r.type === "attributes") translateElement(r.target)
            else for (const n of r.addedNodes) walk(n)
        }
    })
    // watched from the start, so text is swapped as the page is read in, before it shows
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS })
    const finish = () => {
        walk(document.body)
        if (document.title) { const zh = lookup(document.title); if (zh !== null) document.title = zh }
    }
    if (document.readyState !== "loading") finish()
    else document.addEventListener("DOMContentLoaded", finish)
})()
