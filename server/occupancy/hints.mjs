export const CATEGORY = 'accommodation';

export const REQUEST_KEY_HINTS = {
  accommodation: {
    checkIn:  ['checkin','check_in','arrival','from','startdate','datefrom'],
    checkOut: ['checkout','check_out','departure','to','enddate','dateto'],
    adults:   ['adults','group_adults','guests','pax'],
    children: ['children','group_children','kids','children_ages','childages'],
    rooms:    ['rooms','no_rooms','room_count'],
    location: ['dest_id','city','q','regionid','geoid','place_id','destination','ss','search'],
    priceMin: ['min_price','price_min','pricefrom','price_from'],
    priceMax: ['max_price','price_max','priceto','price_to'],
    rating:   ['review_score','rating','stars','starrating']
  }
};