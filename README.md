# Receipt Split

Snap a photo of a grocery receipt, tag who each item is for, and see how much everyone owes the person who paid.

**Live app:** https://kuhyar-saeedi.github.io/receipt-split/ — open in Safari → Share → *Add to Home Screen*.

## How it works

1. **Who's in** – add everyone's initials and tap the person who paid.
2. **Receipt** – take or pick a photo. Text recognition ([Tesseract.js](https://github.com/naptha/tesseract.js)) runs on the phone itself: free, no account, no server.
3. **Who's it for** – tap initials on each line, or **ALL** to split it between everyone. Initials written neatly in the left margin are often read automatically.
4. **Settle up** – the app shows `M → K €4,62` for each person and shares the summary to WhatsApp.

The buyer's own share is never counted as debt. Shared items are split to the cent, and discount lines (`SCONTO …`) follow the item above them.

## Accuracy checks

- The app ignores quantity lines such as `Cad 0,85 Pz. 2` and uses them to fill in or correct the line price.
- If the lines don't add up to `TOTALE COMPLESSIVO`, it tries the common misreadings (e.g. Lidl's slashed `0` read as `8`), and then warns you if the totals still don't match.

## Tips for photos

Flat receipt, good light, whole receipt in the frame. Write initials in the **left margin** before the item name, not over or next to the prices.

## Files

| File | What it does |
|---|---|
| `index.html`, `style.css` | UI |
| `app.js` | State, scanning, rendering |
| `parser.js` | Receipt text → items/total, and the split maths (no DOM; works in Node) |
| `sw.js`, `manifest.webmanifest`, `icons/` | Home-screen app + offline support |
