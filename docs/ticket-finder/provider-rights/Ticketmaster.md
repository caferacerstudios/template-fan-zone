# Ticketmaster Discovery API rights record

Operator approval supplied for the Ticketmaster Public Discovery API and the
Consumer Key. This repository treats Ticketmaster as an official-event,
`event-summary` source only. The approved integration searches by event name
and local date and verifies the public URL's legacy event ID; it does not imply Inventory Status, listing-level inventory,
affiliate, logo, seat-map, or trademark rights.

Displayable Discovery fields are event identity/name/URL, venue,
date/time/timezone, event status, currency, and genuine Discovery `priceRanges`
fields when returned. Each Discovery range is published separately by its
provider range type as bounded integer cents with nullable bounds and
`priceBasis: "unknown"`; no fee-complete meaning is inferred. Event price ranges
are never represented as individual listings, quantity-specific prices, all-in
totals, or ranked/labeled as cheapest. The separately gated Ticketmaster
Inventory Status API is not approved or used by this integration. Raw API
responses and credentials are not published or retained.
