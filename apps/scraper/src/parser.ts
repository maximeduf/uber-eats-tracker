export interface ScrapedOrder {
  restaurantName: string;
  totalPrice: number;
  orderedAtText: string;
  sourceSignature: string;
}

const pricePattern = /\$\s*([\d,]+(?:\.\d{1,2})?)/;

export function parsePriceFromText(fullText: string): number | null {
  const match = fullText.match(pricePattern);
  if (!match) {
    return null;
  }

  const totalPrice = Number(match[1].replace(/,/g, ''));

  if (Number.isNaN(totalPrice)) {
    return null;
  }

  return totalPrice;
}

export function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function splitOrderedAtText(orderedAtText: string): { orderedDate: string; orderedTime: string } {
  const segments = orderedAtText
    .split(',')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  if (segments.length >= 3) {
    return {
      orderedDate: `${segments[0]}, ${segments[1]}`,
      orderedTime: segments.slice(2).join(', ')
    };
  }

  return {
    orderedDate: orderedAtText,
    orderedTime: ''
  };
}

export function buildScrapedOrder(input: {
  restaurantName: string;
  totalPrice: number;
  orderedAtText: string;
}): ScrapedOrder {
  return {
    restaurantName: input.restaurantName,
    totalPrice: input.totalPrice,
    orderedAtText: input.orderedAtText,
    sourceSignature: `${input.restaurantName}__${input.orderedAtText}__${input.totalPrice}`
  };
}
