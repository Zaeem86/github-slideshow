# ZEMO SIIRTO – platform prototype

*Your car. Our driver. Your destination.* – Auton siirto Suomessa, luotettavasti.

Open `index.html` in a browser (no build step, no backend). Data is stored in the browser's localStorage.

## Customer platform
- Create a car transfer request (route, date, vehicle, notes)
- Automatic price by distance (24 Finnish cities, base fee + €/km, minimum price, VAT 25.5%)
- Payment (simulated: card with Luhn check, MobilePay, company invoice) and booking confirmation
- Order tracking with a status timeline
- Order history and printable invoices

## Driver platform
- Registration and verification (licence, age ≥ 20, IBAN check, admin approval)
- View available transfer jobs
- Accept or reject a job
- Pickup / delivery details with handover checklist (odometer, fuel, damage, receiver)
- Earnings calculation (driver share of price excl. VAT)

## Admin platform
- Overview (revenue, payouts, margin), approve/reject drivers, assign drivers, cancel orders, edit pricing rules, load demo data

> Payments are simulated. Before going live, add a real backend, authentication and a payment provider (e.g. Stripe or Paytrail).
