# Receipt Split

Split a shared grocery receipt: one person pays, and the app works out how much everyone else owes them.

**Live app:** https://kuhyar-saeedi.github.io/receipt-split/. Open it in Safari, then Share → *Add to Home Screen*.

## How it works

1. **People**: add everyone's name, including the buyer, and tap whoever paid.
2. **Items**: type each price (the item name is optional) and tap who it's for. **ALL** splits it between everyone. Press Enter on a price to jump to the next item.
3. **Settle up**: shows `Ali → Kuhyar €3,85` for each person, with their item breakdown. *Share result* sends the list to WhatsApp.

- The buyer's own share is never counted as debt.
- Shared items are split to the cent (€10 ÷ 3 = 3,33 + 3,33 + 3,34), so the shares always add up exactly.
- Optionally enter the receipt total to check that nothing was missed.
- Everything is saved on the phone. *New receipt* clears the items and keeps the people.

No server, no account, no cost. Plain HTML/CSS/JS on GitHub Pages.

| File | What it does |
|---|---|
| `index.html`, `style.css` | UI |
| `app.js` | State, rendering, input handling |
| `split.js` | The split maths (no DOM; also runs in Node) |
| `sw.js`, `manifest.webmanifest`, `icons/` | Home-screen app + offline support |
