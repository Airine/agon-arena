import { describe, it, expect } from 'vitest';
import {
  createBook,
  addOrder,
  cancelOrder,
  getBestBid,
  getBestAsk,
  getMidPrice,
  getSpread,
  getTopLevels,
} from '../book.js';
import type { LOBOrder } from '../types.js';

function makeOrder(overrides: Partial<LOBOrder> & Pick<LOBOrder, 'id' | 'agentId' | 'side' | 'price' | 'qty'>): LOBOrder {
  return {
    ts: Date.now(),
    ...overrides,
  };
}

describe('book', () => {
  it('crossing bid/ask → trade fires, both orders removed from book', () => {
    let book = createBook();

    // Place an ask at 100 for qty 5
    const ask = makeOrder({ id: 'ask-1', agentId: 'seller', side: 'ask', price: 100, qty: 5, ts: 1000 });
    const r1 = addOrder(book, ask);
    book = r1.book;
    expect(r1.trades).toHaveLength(0);

    // Place a crossing bid at 100 for qty 5
    const bid = makeOrder({ id: 'bid-1', agentId: 'buyer', side: 'bid', price: 100, qty: 5, ts: 2000 });
    const r2 = addOrder(book, bid);
    book = r2.book;

    expect(r2.trades).toHaveLength(1);
    expect(r2.trades[0]).toMatchObject({ buyerId: 'buyer', sellerId: 'seller', price: 100, qty: 5 });
    expect(book.bids).toHaveLength(0);
    expect(book.asks).toHaveLength(0);
  });

  it('partial fill → remainder stays in book with correct qty', () => {
    let book = createBook();

    const ask = makeOrder({ id: 'ask-1', agentId: 'seller', side: 'ask', price: 100, qty: 10, ts: 1000 });
    const r1 = addOrder(book, ask);
    book = r1.book;

    const bid = makeOrder({ id: 'bid-1', agentId: 'buyer', side: 'bid', price: 100, qty: 6, ts: 2000 });
    const r2 = addOrder(book, bid);
    book = r2.book;

    expect(r2.trades).toHaveLength(1);
    expect(r2.trades[0]!.qty).toBe(6);
    // Remaining 4 units should still be in the ask side
    expect(book.asks).toHaveLength(1);
    expect(book.asks[0]!.qty).toBe(4);
    expect(book.bids).toHaveLength(0);
  });

  it('cancel nonexistent order ID → no-op, book unchanged', () => {
    let book = createBook();
    const ask = makeOrder({ id: 'ask-1', agentId: 'seller', side: 'ask', price: 100, qty: 5, ts: 1000 });
    book = addOrder(book, ask).book;

    const bookAfterCancel = cancelOrder(book, 'nonexistent-id');
    expect(bookAfterCancel.asks).toHaveLength(1);
    expect(bookAfterCancel.bids).toHaveLength(0);
  });

  it('cancel existing order → removed from book', () => {
    let book = createBook();
    const ask = makeOrder({ id: 'ask-1', agentId: 'seller', side: 'ask', price: 100, qty: 5, ts: 1000 });
    const bid = makeOrder({ id: 'bid-1', agentId: 'buyer', side: 'bid', price: 90, qty: 5, ts: 2000 });
    book = addOrder(book, ask).book;
    book = addOrder(book, bid).book;
    expect(book.asks).toHaveLength(1);
    expect(book.bids).toHaveLength(1);

    book = cancelOrder(book, 'ask-1');
    expect(book.asks).toHaveLength(0);
    expect(book.bids).toHaveLength(1);
  });

  it('price-time priority: two asks at same price → earlier timestamp fills first', () => {
    let book = createBook();

    // Two asks at same price, different timestamps
    const ask1 = makeOrder({ id: 'ask-early', agentId: 'seller-early', side: 'ask', price: 100, qty: 5, ts: 1000 });
    const ask2 = makeOrder({ id: 'ask-late', agentId: 'seller-late', side: 'ask', price: 100, qty: 5, ts: 2000 });
    book = addOrder(book, ask1).book;
    book = addOrder(book, ask2).book;

    // A bid that crosses, large enough to fill only one ask
    const bid = makeOrder({ id: 'bid-1', agentId: 'buyer', side: 'bid', price: 100, qty: 5, ts: 3000 });
    const result = addOrder(book, bid);

    expect(result.trades).toHaveLength(1);
    // Should have filled the earlier ask
    expect(result.trades[0]!.sellerId).toBe('seller-early');
    // Late ask remains
    expect(result.book.asks).toHaveLength(1);
    expect(result.book.asks[0]!.agentId).toBe('seller-late');
  });

  it('getBestBid, getBestAsk, getMidPrice, getSpread return correct values', () => {
    let book = createBook();
    const bid = makeOrder({ id: 'bid-1', agentId: 'buyer', side: 'bid', price: 98, qty: 3, ts: 1000 });
    const ask = makeOrder({ id: 'ask-1', agentId: 'seller', side: 'ask', price: 102, qty: 3, ts: 1000 });
    book = addOrder(book, bid).book;
    book = addOrder(book, ask).book;

    expect(getBestBid(book)!.price).toBe(98);
    expect(getBestAsk(book)!.price).toBe(102);
    expect(getMidPrice(book, 0)).toBe(100);
    expect(getSpread(book)).toBe(4);
  });

  it('getTopLevels(2) aggregates correctly from a 5-order book', () => {
    let book = createBook();
    // 5 asks at different prices
    for (let i = 1; i <= 5; i++) {
      const ask = makeOrder({ id: `ask-${i}`, agentId: `seller-${i}`, side: 'ask', price: 100 + i, qty: i, ts: i * 1000 });
      book = addOrder(book, ask).book;
    }

    const top2 = getTopLevels(book.asks, 2);
    expect(top2).toHaveLength(2);
    // Asks sorted lowest first, so top 2 should be prices 101 and 102
    expect(top2[0]!.price).toBe(101);
    expect(top2[1]!.price).toBe(102);
  });
});
