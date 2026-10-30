/**
 * UI journeys: deliberately few. They prove the pieces are wired together in a real
 * browser; pricing rules, stock and payment edge cases are covered lower in the pyramid.
 *
 * Assertions read the UI for what the shopper sees, then confirm the outcome through
 * the API instead of scraping more of the page.
 */
import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('row', { name: /Wireless mouse/ })).toBeVisible();
});

test('a shopper buys two products with a coupon @smoke', async ({ page, request }) => {
  await page.getByLabel('Quantity of Wireless mouse').fill('1');
  await page.getByLabel('Quantity of USB-C cable').fill('1');
  await page.getByLabel('Coupon code').fill('save10');
  await page.getByRole('button', { name: 'Place order' }).click();

  await expect(page.getByRole('heading', { name: 'Order confirmed' })).toBeVisible();
  // 24.50 + 9.99 = 34.49; -10 % = 31.04; + 4.99 shipping + 2.48 tax = 38.51
  await expect(page.getByTestId('order-total')).toHaveText('€38.51');

  const orderId = await page.getByTestId('order-id').textContent();
  const order = await request.get(`/orders/${orderId}`);
  expect(await order.json()).toMatchObject({
    status: 'PAID',
    couponCode: 'SAVE10',
    totalCents: 3_851,
  });
});

test('a declined card shows an error and confirms nothing', async ({ page }) => {
  await page.getByLabel('Quantity of USB-C cable').fill('1');
  await page.getByLabel('Payment method').selectOption('Visa ending 0002 (always declined)');
  await page.getByRole('button', { name: 'Place order' }).click();

  await expect(page.getByRole('alert')).toHaveText('The payment was declined');
  await expect(page.getByRole('heading', { name: 'Order confirmed' })).toBeHidden();
});

test('an invalid coupon is explained to the shopper', async ({ page }) => {
  await page.getByLabel('Quantity of USB-C cable').fill('1');
  await page.getByLabel('Coupon code').fill('BOGUS');
  await page.getByRole('button', { name: 'Place order' }).click();

  await expect(page.getByRole('alert')).toHaveText('Coupon BOGUS does not exist');
});

test('placing an empty order asks for a product', async ({ page }) => {
  await page.getByRole('button', { name: 'Place order' }).click();

  await expect(page.getByRole('alert')).toHaveText('Add at least one product.');
});
