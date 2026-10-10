# Stockroom

**Inventory control for a busy stockroom: orders, receiving, cycle counts, and monthly
reports, in one place.** It runs in any browser, including phones, and keeps its data on the
device.

**Try it:** https://blkctrs-sys.github.io/stockroom/ (opens with sample data for a made-up
restaurant)

## Why I built it

I manage inventory for a high-volume restaurant: ordering from 10 vendors, receiving
deliveries, rotating stock, and tracking costs in a shared spreadsheet. Spreadsheets work
until they don't. When I audited ours I found:

- a delivery entered with an extra digit ($404.85 a case instead of $40.49) that inflated the
  month by about $5,500,
- a "price difference" formula that showed fake changes whenever an item wasn't ordered,
- prices compared across different units (a case vs. a single cucumber), and
- a quantity and price typed in with no total, so the item silently dropped out of the month.

Stockroom is the system I wanted instead: it catches those mistakes when the data is
entered, not weeks later.

## What it does

**Orders & receiving**
- Build purchase orders by vendor. "Add items below par" fills in what you need.
- Receive deliveries against the PO: record shorts, damaged items, and the invoice cost.
- **Price check on receipt:** any cost 40% or more off the last price *in the same unit* is
  flagged before it reaches your books, and unit changes (case → each) are called out
  instead of being treated as price changes.
- Fill rate and receiving issues are tracked for vendor credit follow-up.

**Cycle counts**
- Count one category, one vendor, or everything.
- **Blind counts** hide the expected quantity so counters aren't nudged.
- Review variances by quantity and dollar value, assign a reason to each discrepancy
  (unlogged waste, receiving error, theft/unexplained…), then post to adjust stock.
- Accuracy is tracked count over count.

**Stock log**
- Record waste/damage, transfers in and out, and returns to vendor, so the system matches
  the shelf.

**Reports & dashboard**
- Spend by vendor and month, inventory value, open deliveries, low stock, and recent
  same-unit price changes.
- A monthly report covers purchases, fill rate, logged waste, count variance by reason, top
  items, and receiving issues. Print it to PDF or export the line detail to CSV.

**Bring your own data**
- Imports a Google Sheets ordering sheet (dates across the top, vendors and items down the
  side), flags suspicious lines and mixed units during import, and keeps full backups as a
  file.

## Built with

Plain HTML, CSS, and JavaScript, with no frameworks and no server. Data is saved in the
browser's local storage and never leaves the device. Charts are hand-built SVG with hover
tooltips, a table view for accessibility, light and dark themes, and a colorblind-checked
palette.

```
index.html          app shell and navigation
styles.css          layout, themes, print styles
js/store.js         data model: on-hand from a movement ledger, price history, checks
js/demo.js          generates the sample restaurant (≈14 weeks of activity)
js/importer.js      Google Sheets CSV import with error flags
js/charts.js        SVG charts
js/pages-*.js       dashboard, orders/receiving, counts, items, stock log, reports, data
```

Run it locally by opening `index.html` through any static server, for example
`npx http-server`.
