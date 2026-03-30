import type { LOBOrder, LOBTrade } from './types.js';

export interface BookState {
  bids: LOBOrder[];  // sorted highest price first, then by ts ascending
  asks: LOBOrder[];  // sorted lowest price first, then by ts ascending
}

export function createBook(): BookState {
  return { bids: [], asks: [] };
}

export function addOrder(
  book: BookState,
  order: LOBOrder,
): { book: BookState; trades: LOBTrade[] } {
  const trades: LOBTrade[] = [];
  let remainingQty = order.qty;

  if (order.side === 'bid') {
    // Match against asks (ascending price): fill while ask.price <= bid.price
    const asks = [...book.asks];
    let i = 0;
    while (i < asks.length && remainingQty > 0) {
      const ask = asks[i]!;
      if (ask.price > order.price) break;

      const fillQty = Math.min(remainingQty, ask.qty);
      trades.push({
        buyerId: order.agentId,
        sellerId: ask.agentId,
        price: ask.price,
        qty: fillQty,
        ts: order.ts,
      });
      remainingQty -= fillQty;
      ask.qty -= fillQty;
      if (ask.qty === 0) {
        asks.splice(i, 1);
      } else {
        i++;
      }
    }

    const newBids = remainingQty > 0
      ? sortBids([...book.bids, { ...order, qty: remainingQty }])
      : [...book.bids];

    return { book: { bids: newBids, asks }, trades };
  } else {
    // ask — match against bids (descending price): fill while bid.price >= ask.price
    const bids = [...book.bids];
    let i = 0;
    while (i < bids.length && remainingQty > 0) {
      const bid = bids[i]!;
      if (bid.price < order.price) break;

      const fillQty = Math.min(remainingQty, bid.qty);
      trades.push({
        buyerId: bid.agentId,
        sellerId: order.agentId,
        price: bid.price,
        qty: fillQty,
        ts: order.ts,
      });
      remainingQty -= fillQty;
      bid.qty -= fillQty;
      if (bid.qty === 0) {
        bids.splice(i, 1);
      } else {
        i++;
      }
    }

    const newAsks = remainingQty > 0
      ? sortAsks([...book.asks, { ...order, qty: remainingQty }])
      : [...book.asks];

    return { book: { bids, asks: newAsks }, trades };
  }
}

function sortBids(orders: LOBOrder[]): LOBOrder[] {
  return orders.sort((a, b) => {
    if (b.price !== a.price) return b.price - a.price; // highest first
    return a.ts - b.ts; // earlier timestamp first (time priority)
  });
}

function sortAsks(orders: LOBOrder[]): LOBOrder[] {
  return orders.sort((a, b) => {
    if (a.price !== b.price) return a.price - b.price; // lowest first
    return a.ts - b.ts; // earlier timestamp first
  });
}

export function cancelOrder(book: BookState, orderId: string): BookState {
  const bids = book.bids.filter((o) => o.id !== orderId);
  const asks = book.asks.filter((o) => o.id !== orderId);
  return { bids, asks };
}

export function getBestBid(book: BookState): LOBOrder | null {
  return book.bids[0] ?? null;
}

export function getBestAsk(book: BookState): LOBOrder | null {
  return book.asks[0] ?? null;
}

export function getMidPrice(book: BookState, fallback: number): number {
  const bid = getBestBid(book);
  const ask = getBestAsk(book);
  if (bid && ask) return (bid.price + ask.price) / 2;
  if (bid) return bid.price;
  if (ask) return ask.price;
  return fallback;
}

export function getSpread(book: BookState): number {
  const bid = getBestBid(book);
  const ask = getBestAsk(book);
  if (bid && ask) return ask.price - bid.price;
  return 0;
}

export function getTopLevels(orders: LOBOrder[], n = 10): LOBOrder[] {
  return orders.slice(0, n);
}
