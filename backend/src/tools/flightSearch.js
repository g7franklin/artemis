const CABIN_TO_DUFFEL = {
  ECONOMY: 'economy',
  BUSINESS: 'business',
  FIRST: 'first',
};

function duffelHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    'Duffel-Version': 'v2',
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
}

/**
 * @param {unknown} body
 * @returns {string}
 */
function duffelErrorMessage(body) {
  if (!body || typeof body !== 'object') return 'Unknown error';
  const errors = /** @type {{ errors?: Array<{ title?: string, message?: string }> }} */ (
    body
  ).errors;
  if (Array.isArray(errors) && errors.length > 0) {
    const e = errors[0];
    return e?.message || e?.title || JSON.stringify(errors[0]);
  }
  return JSON.stringify(body).slice(0, 500);
}

/**
 * @param {Record<string, unknown>} offer
 * @param {number} index
 */
function formatDuffelOffer(offer, index) {
  const slice = offer.slices?.[0];
  const segs = slice?.segments;
  if (!Array.isArray(segs) || segs.length === 0) return null;
  const first = segs[0];
  const last = segs[segs.length - 1];
  if (!first || !last) return null;

  const carrier =
    first.operating_carrier?.name ?? first.marketing_carrier?.name ?? '';
  const code =
    first.operating_carrier?.iata_code ??
    first.marketing_carrier?.iata_code ??
    '';
  const flightNum =
    first.operating_carrier_flight_number ??
    first.marketing_carrier_flight_number ??
    '';
  const flightLabel =
    code && flightNum ? `${code}${flightNum}` : flightNum || code || '';

  const dep = first.departing_at ?? '';
  const arr = last.arriving_at ?? '';
  const dur = slice.duration ?? '';
  const amt = offer.total_amount ?? '';
  const cur = offer.total_currency ?? '';

  const carrierPart = carrier
    ? `${carrier}${flightLabel ? ` (${flightLabel})` : ''}`
    : flightLabel || 'Flight';

  return `${index + 1}) ${carrierPart}, departs ${dep}, arrives ${arr}, duration ${dur}, total ${amt} ${cur}`;
}

/**
 * @param {{ origin: string, destination: string, date: string, adults?: number, cabin?: string }} params
 */
export async function executeSearchFlights(params) {
  const {
    origin,
    destination,
    date,
    adults = 1,
    cabin = 'ECONOMY',
  } = params;

  const token = process.env.DUFFEL_ACCESS_TOKEN?.trim();
  if (!token) {
    throw new Error('Missing DUFFEL_ACCESS_TOKEN');
  }

  const base =
    process.env.DUFFEL_API_BASE_URL?.replace(/\/$/, '') ||
    'https://api.duffel.com';
  const cabinClass = CABIN_TO_DUFFEL[cabin] ?? 'economy';
  const n = Math.min(9, Math.max(1, Math.floor(Number(adults) || 1)));

  const url = new URL(`${base}/air/offer_requests`);
  const timeoutMs = process.env.DUFFEL_SUPPLIER_TIMEOUT_MS?.trim();
  if (timeoutMs) {
    url.searchParams.set('supplier_timeout', timeoutMs);
  }
  url.searchParams.set('return_offers', 'true');

  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: duffelHeaders(token),
    body: JSON.stringify({
      data: {
        slices: [
          {
            origin: origin.toUpperCase(),
            destination: destination.toUpperCase(),
            departure_date: date,
          },
        ],
        passengers: Array.from({ length: n }, () => ({ type: 'adult' })),
        cabin_class: cabinClass,
        max_connections: 1,
      },
    }),
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      `Duffel flight search failed: ${res.status} ${duffelErrorMessage(payload)}`
    );
  }

  const data = payload.data;
  const offers = Array.isArray(data?.offers) ? data.offers : [];
  const top = offers.slice(0, 3);

  if (top.length === 0) {
    return {
      summary:
        'No flights found for that route and date. You might try nearby dates or airports.',
      offers: [],
    };
  }

  const lines = top.map((o, i) => formatDuffelOffer(o, i)).filter(Boolean);
  return {
    summary: lines.join('. '),
    rawCount: offers.length,
  };
}

export const searchFlightsTool = {
  name: 'search_flights',
  description:
    'Search for available flights between two airports (IATA codes) via Duffel. Returns up to three options with operating carrier name, flight number, departure and arrival times, slice duration, and total price — describe them in natural speech. Search only; booking is not performed here.',
  parameters: {
    type: 'object',
    properties: {
      origin: {
        type: 'string',
        description: 'Origin airport IATA code (e.g. SFO)',
      },
      destination: {
        type: 'string',
        description: 'Destination airport IATA code (e.g. JFK)',
      },
      date: {
        type: 'string',
        description: 'Departure date in YYYY-MM-DD',
      },
      adults: {
        type: 'number',
        description: 'Number of adult passengers',
      },
      cabin: {
        type: 'string',
        enum: ['ECONOMY', 'BUSINESS', 'FIRST'],
        description: 'Cabin class',
      },
    },
    required: ['origin', 'destination', 'date'],
  },
};
