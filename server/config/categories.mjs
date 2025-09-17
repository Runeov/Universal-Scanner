// server/config/categories.mjs

// Registry of categories your scanner can target.
// Start with "accommodation"; append others later (auctions, social, …).
export const CATEGORY_DEFS = {
  accommodation: {
    id: 'accommodation',
    label: 'Accommodation',
    patterns: {
      // URLs that likely carry search/availability payloads
      availability: [
        /\/accommodations\/availability/i,
        /\/accommodations\/search/i,
        /\/availability/i,
        /\/searchresults\.html/i
      ],
      search: [
        /\/search/i,
        /\/browse/i,
      ],
    },
    // Hints for auto-filling extract keys in the UI (optional)
    paramHints: {
      checkIn:  ['checkin','check_in','datefrom','from','arrival'],
      checkOut: ['checkout','check_out','dateto','to','departure'],
      adults:   ['adults','group_adults','guests','pax'],
      venueId:  ['venueid','hotelid','propertyid','id'],
    },
  },
  // auctions: { … }  // add later
  // social:   { … }  // add later
};

export const DEFAULT_CATEGORY = 'accommodation';
