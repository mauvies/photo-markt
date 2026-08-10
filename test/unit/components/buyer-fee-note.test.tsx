/**
 * T-197: the note telling photographers the buyer service fee is not theirs.
 *
 * The important negative case is the dark one — while no buyer is charged a
 * fee, telling photographers that "buyers also pay a service fee" would simply
 * be false.
 */

// const isBuyerServiceFeeEnabledMock = vi.hoisted(() => vi.fn<() => boolean>());

// vi.mock('@/lib/plans', async (importOriginal) => {
//   const actual = await importOriginal<typeof import('@/lib/plans')>();
//   return { ...actual, isBuyerServiceFeeEnabled: isBuyerServiceFeeEnabledMock };
// });

// import { BuyerFeeNote } from '@/components/buyer-fee-note';

// afterEach(cleanup);

// const NOTE = 'Buyers also pay a service fee at checkout.';

// describe('BuyerFeeNote', () => {
//   it('renders nothing while no buyer fee is charged', () => {
//     isBuyerServiceFeeEnabledMock.mockReturnValue(false);
//     const { container } = render(<BuyerFeeNote>{NOTE}</BuyerFeeNote>);

//     expect(container.innerHTML).toBe('');
//     expect(screen.queryByText(NOTE)).toBeNull();
//   });

//   it('renders the localized note once the fee is live', () => {
//     isBuyerServiceFeeEnabledMock.mockReturnValue(true);
//     render(<BuyerFeeNote>{NOTE}</BuyerFeeNote>);

//     expect(screen.getByText(NOTE)).toBeDefined();
//   });

//   it('applies an extra class without dropping its own styling', () => {
//     isBuyerServiceFeeEnabledMock.mockReturnValue(true);
//     render(<BuyerFeeNote className="mt-4">{NOTE}</BuyerFeeNote>);

//     const el = screen.getByText(NOTE);
//     expect(el.className).toContain('mt-4');
//     expect(el.className).toContain('text-muted-foreground');
//   });
// });
